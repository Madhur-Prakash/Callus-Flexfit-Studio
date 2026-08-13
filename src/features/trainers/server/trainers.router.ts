import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, gte } from "drizzle-orm";
import type { Database } from "@/db/client";
import { classes, trainerAvailability } from "@/db/schema";
import { nowIso } from "@/lib/datetime";
import { isStaff, isTrainer, type Role } from "@/lib/roles";
import { router, protectedProcedure } from "@/server/trpc/procedures";
import { overlaps, toWeeklySlot } from "./availability";

/**
 * These procedures are trainer-only rather than staff-only, so they cannot use
 * `staffProcedure` and check the role themselves. An admin is refused too: the
 * data is scoped to `ctx.user.id`, so there is no meaningful admin view here.
 */
function assertTrainer(role: Role): void {
  if (!isTrainer(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only trainers can access this.",
    });
  }
}

export const trainersRouter = router({
  upcomingClasses: protectedProcedure.query(async ({ ctx }) => {
    assertTrainer(ctx.user.role);

    return ctx.db
      .select({
        id: classes.id,
        name: classes.name,
        room: classes.room,
        startsAt: classes.startsAt,
        durationMin: classes.durationMin,
        cancelled: classes.cancelled,
      })
      .from(classes)
      .where(
        and(
          eq(classes.trainerId, ctx.user.id),
          gte(classes.startsAt, nowIso()),
          eq(classes.cancelled, false),
        ),
      )
      .orderBy(classes.startsAt);
  }),

  availability: protectedProcedure.query(async ({ ctx }) => {
    assertTrainer(ctx.user.role);

    return ctx.db
      .select()
      .from(trainerAvailability)
      .where(eq(trainerAvailability.trainerId, ctx.user.id))
      .orderBy(trainerAvailability.dayOfWeek);
  }),

  /** One window per weekday: setting a day again replaces it. */
  setAvailability: protectedProcedure
    .input(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string(),
        endTime: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertTrainer(ctx.user.role);

      const existing = await findAvailability(ctx.db, ctx.user.id, input.dayOfWeek);

      if (existing) {
        return ctx.db
          .update(trainerAvailability)
          .set({ startTime: input.startTime, endTime: input.endTime })
          .where(eq(trainerAvailability.id, existing.id))
          .returning()
          .get();
      }

      return ctx.db
        .insert(trainerAvailability)
        .values({
          trainerId: ctx.user.id,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
        })
        .returning()
        .get();
    }),

  removeAvailability: protectedProcedure
    .input(z.object({ dayOfWeek: z.number().int().min(0).max(6) }))
    .mutation(async ({ ctx, input }) => {
      assertTrainer(ctx.user.role);

      const existing = await findAvailability(ctx.db, ctx.user.id, input.dayOfWeek);
      if (existing) {
        await ctx.db
          .delete(trainerAvailability)
          .where(eq(trainerAvailability.id, existing.id));
      }

      // Clearing a day that was never set is a no-op, not an error.
      return { success: true };
    }),

  /**
   * Whether a trainer could take a class at a given time: inside their weekly
   * window, and not already teaching. Open to staff, since it is used when
   * scheduling on someone else's behalf.
   */
  checkAvailability: protectedProcedure
    .input(
      z.object({
        trainerId: z.number(),
        startsAt: z.string(),
        durationMin: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!isStaff(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Staff only." });
      }

      const slot = toWeeklySlot(input.startsAt, input.durationMin);

      const availability = await findAvailability(
        ctx.db,
        input.trainerId,
        slot.dayOfWeek,
      );

      if (!availability) {
        return { available: false, reason: "No availability set for this day" };
      }

      const withinHours =
        slot.startTime >= availability.startTime && slot.endTime <= availability.endTime;

      if (!withinHours) {
        return { available: false, reason: "Outside availability hours" };
      }

      const trainerClasses = await ctx.db
        .select()
        .from(classes)
        .where(
          and(
            eq(classes.trainerId, input.trainerId),
            eq(classes.cancelled, false),
          ),
        );

      const clash = trainerClasses.some((cls) =>
        overlaps(slot, { startsAt: cls.startsAt, durationMin: cls.durationMin }),
      );

      if (clash) {
        return {
          available: false,
          reason: "Trainer already has a class at this time",
        };
      }

      return { available: true };
    }),
});

function findAvailability(db: Database, trainerId: number, dayOfWeek: number) {
  return db
    .select()
    .from(trainerAvailability)
    .where(
      and(
        eq(trainerAvailability.trainerId, trainerId),
        eq(trainerAvailability.dayOfWeek, dayOfWeek),
      ),
    )
    .get();
}
