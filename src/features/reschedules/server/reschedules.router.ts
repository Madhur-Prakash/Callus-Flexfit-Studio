import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { bookings, classes, reschedules } from "@/db/schema";
import { nowIso } from "@/lib/datetime";
import { promoteFromWaitlist } from "@/features/bookings/server/waitlist";
import {
  chargeCredits,
  findChargeableMembership,
} from "@/features/memberships/server/membership-credits";
import { notifyWaitlistPromotion } from "@/features/notifications/server/notify";
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

      const { booking, fromClass, toClass, targetIsFull, outstandingCredits } =
        evaluation;

      const { newBooking, promoted } = await ctx.db.transaction(async (tx) => {
        // The member carries across whatever they already paid, and tops up
        // only if the new spot costs more than the old one.
        const created = await tx
          .insert(bookings)
          .values({
            classId: toClass.id,
            userId: ctx.user.id,
            membershipId: booking.membershipId,
            status: targetIsFull ? "waitlisted" : "booked",
            creditsUsed: booking.creditsUsed + outstandingCredits,
          })
          .returning()
          .get();

        if (outstandingCredits > 0 && booking.membershipId) {
          const membership = await findChargeableMembership(
            tx,
            booking.membershipId,
            outstandingCredits,
          );
          if (membership) {
            await chargeCredits(tx, membership, outstandingCredits);
          }
        }

        await tx
          .update(bookings)
          .set({ status: "cancelled", cancelledAt: nowIso() })
          .where(eq(bookings.id, booking.id));

        await tx.insert(reschedules).values({
          userId: ctx.user.id,
          fromBookingId: booking.id,
          toBookingId: created.id,
          fromClassId: fromClass.id,
          toClassId: toClass.id,
        });

        // Moving away frees the original spot, exactly as cancelling would, so
        // whoever is waiting for it should get it. This used to be skipped, and
        // the spot sat empty with people queuing for it.
        const movedOn =
          booking.status === "booked" ? await promoteFromWaitlist(tx, fromClass) : null;

        return { newBooking: created, promoted: movedOn };
      });

      if (promoted) {
        await notifyWaitlistPromotion(ctx.db, promoted.userId, fromClass);
      }

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
