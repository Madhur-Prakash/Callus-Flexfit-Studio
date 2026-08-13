import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { classes, bookings, corporateBookings, users } from "@/db/schema";
import { nowIso } from "@/lib/datetime";
import { findConfirmedBookings } from "@/features/bookings/server/booking-repository";
import { findActiveCorporateBookings, refundToPool } from "@/features/corporate/server/company-credits";
import { refundCredits } from "@/features/memberships/server/membership-credits";
import { notifyClassCancelled } from "@/features/notifications/server/notify";
import {
  router,
  publicProcedure,
  staffProcedure,
  adminProcedure,
} from "@/server/trpc/procedures";

export const classesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          from: z.string().optional(),
          to: z.string().optional(),
          includeCancelled: z.boolean().default(false),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const filters = [];
      if (input.from) filters.push(gte(classes.startsAt, input.from));
      if (input.to) filters.push(lte(classes.startsAt, input.to));
      if (!input.includeCancelled) filters.push(eq(classes.cancelled, false));

      const rows = await ctx.db
        .select({
          id: classes.id,
          name: classes.name,
          description: classes.description,
          room: classes.room,
          capacity: classes.capacity,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          creditCost: classes.creditCost,
          cancelled: classes.cancelled,
          trainerName: users.name,
          // Counts attended as well as booked: someone who has already been
          // checked in still occupies their spot. Counting only 'booked' made
          // spots appear to free up as members arrived, so a full class could
          // be over-booked from the public schedule.
          //
          // The leftJoin below is load-bearing for this subquery, not just for
          // the trainer name: Drizzle emits column references unqualified when
          // a query has no join, which would turn
          // `bookings.class_id = classes.id` into `bookings.class_id =
          // bookings.id` and quietly uncorrelate the count. Don't remove the
          // join without rewriting this.
          booked: sql<number>`(
            select count(*) from ${bookings}
            where ${bookings.classId} = ${classes.id}
              and ${bookings.status} in ('booked','attended')
          )`.as("booked"),
        })
        .from(classes)
        .leftJoin(users, eq(classes.trainerId, users.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(classes.startsAt));

      return rows.map((r) => ({
        ...r,
        spotsLeft: Math.max(0, r.capacity - Number(r.booked)),
        full: Number(r.booked) >= r.capacity,
      }));
    }),

  byId: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const cls = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, input.id))
        .get();

      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      const roster = await ctx.db
        .select({
          bookingId: bookings.id,
          status: bookings.status,
          memberName: users.name,
          memberEmail: users.email,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.userId, users.id))
        .where(eq(bookings.classId, cls.id));

      return { ...cls, roster };
    }),

  create: staffProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        trainerId: z.number().optional(),
        room: z.string().min(1),
        capacity: z.number().int().positive(),
        startsAt: z.string(),
        durationMin: z.number().int().positive().default(60),
        creditCost: z.number().int().min(0).default(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .insert(classes)
        .values({
          ...input,
          description: input.description ?? null,
          trainerId: input.trainerId ?? null,
        })
        .returning()
        .get();
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        room: z.string().min(1).optional(),
        capacity: z.number().int().positive().optional(),
        startsAt: z.string().optional(),
        trainerId: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const updated = await ctx.db
        .update(classes)
        .set(patch)
        .where(eq(classes.id, id))
        .returning()
        .get();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }
      return updated;
    }),

  /**
   * Calls a class off.
   *
   * Everyone booked or waitlisted on it is cancelled and made whole: the studio
   * cancelling is not the member's fault, so credits come back regardless of
   * how close to the start time it happens — unlike a member cancelling, which
   * only refunds outside the 12-hour window. Corporate bookings are cancelled
   * too and their credits returned to the employer's pool; previously they were
   * left booked against a class that would never run.
   */
  cancel: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, input.id))
        .get();

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      const { cls, affectedUserIds } = await ctx.db.transaction(async (tx) => {
        const updated = await tx
          .update(classes)
          .set({ cancelled: true })
          .where(eq(classes.id, input.id))
          .returning()
          .get();

        const personal = await findConfirmedBookings(tx, input.id);
        const corporate = await findActiveCorporateBookings(tx, input.id);

        for (const booking of personal) {
          await tx
            .update(bookings)
            .set({ status: "cancelled", cancelledAt: nowIso() })
            .where(eq(bookings.id, booking.id));

          if (booking.membershipId && booking.creditsUsed > 0) {
            await refundCredits(tx, booking.membershipId, booking.creditsUsed);
          }
        }

        for (const booking of corporate) {
          await tx
            .update(corporateBookings)
            .set({ status: "cancelled", cancelledAt: nowIso() })
            .where(eq(corporateBookings.id, booking.id));

          if (booking.creditsUsed > 0) {
            await refundToPool(tx, booking.companyId, booking.creditsUsed);
          }
        }

        return {
          cls: updated,
          affectedUserIds: [...personal, ...corporate].map((b) => b.userId),
        };
      });

      await notifyClassCancelled(ctx.db, affectedUserIds, cls);

      return cls;
    }),
});
