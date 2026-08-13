import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { bookings, classes, reschedules } from "@/db/schema";
import { nowIso } from "@/lib/datetime";
import { router, protectedProcedure } from "@/server/trpc/procedures";
import { evaluateReschedule, FREE_RESCHEDULE_HOURS } from "./reschedule-policy";

export { FREE_RESCHEDULE_HOURS };

const rescheduleInput = z.object({
  fromBookingId: z.number(),
  toClassId: z.number(),
});

export const reschedulesRouter = router({
  reschedule: protectedProcedure
    .input(rescheduleInput)
    .mutation(async ({ ctx, input }) => {
      const evaluation = await evaluateReschedule(ctx.db, ctx.user.id, input);

      if (!evaluation.ok) {
        throw new TRPCError({ code: evaluation.code, message: evaluation.reason });
      }

      const { booking, fromClass, toClass, targetIsFull } = evaluation;

      // The member keeps whatever they already paid for the original spot: the
      // move is neither charged nor refunded.
      const newBooking = await ctx.db
        .insert(bookings)
        .values({
          classId: toClass.id,
          userId: ctx.user.id,
          membershipId: booking.membershipId,
          status: targetIsFull ? "waitlisted" : "booked",
          creditsUsed: booking.creditsUsed,
        })
        .returning()
        .get();

      await ctx.db
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: nowIso() })
        .where(eq(bookings.id, booking.id));

      await ctx.db.insert(reschedules).values({
        userId: ctx.user.id,
        fromBookingId: booking.id,
        toBookingId: newBooking.id,
        fromClassId: fromClass.id,
        toClassId: toClass.id,
      });

      return {
        ok: true,
        newBooking,
        newStatus: targetIsFull ? "waitlisted" : "booked",
      };
    }),

  /**
   * Dry run of `reschedule`, so the UI can explain why a target is unavailable
   * before the member commits to it. Shares the rule set; writes nothing.
   */
  validateReschedule: protectedProcedure
    .input(rescheduleInput)
    .query(async ({ ctx, input }) => {
      const evaluation = await evaluateReschedule(ctx.db, ctx.user.id, input);

      return evaluation.ok
        ? { valid: true, targetIsFull: evaluation.targetIsFull }
        : { valid: false, reason: evaluation.reason };
    }),

  history: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: reschedules.id,
        rescheduledAt: reschedules.rescheduledAt,
        fromClassName: classes.name,
        fromClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        fromClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        toClassName: sql<string>`(
          SELECT ${classes.name} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
      })
      .from(reschedules)
      .innerJoin(classes, eq(reschedules.fromClassId, classes.id))
      .where(eq(reschedules.userId, ctx.user.id))
      .orderBy(desc(reschedules.rescheduledAt));
  }),
});
