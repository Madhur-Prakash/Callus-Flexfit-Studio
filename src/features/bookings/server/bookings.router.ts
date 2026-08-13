import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { DbClient } from "@/db/client";
import { bookings, checkins, classes, corporateBookings, users } from "@/db/schema";
import { hoursFromNowIso, nowIso } from "@/lib/datetime";
import { isStaff } from "@/lib/roles";
import {
  canCover,
  chargeCredits,
  findActiveMembership,
  refundCredits,
} from "@/features/memberships/server/membership-credits";
import { notifyWaitlistPromotion } from "@/features/notifications/server/notify";
import { router, protectedProcedure, staffProcedure } from "@/server/trpc/procedures";
import {
  assertCanActOnBooking,
  assertClassIsBookable,
  FREE_CANCELLATION_HOURS,
  isRefundableCancellation,
} from "./booking-policy";
import { countConfirmedBookings, findActiveBooking } from "./booking-repository";
import { promoteFromWaitlist } from "./waitlist";

export { FREE_CANCELLATION_HOURS };

const checkinSource = z.enum(["front_desk", "kiosk", "app"]);

export const bookingsRouter = router({
  mine: protectedProcedure
    .input(z.object({ includePast: z.boolean().default(false) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: bookings.id,
          status: bookings.status,
          creditsUsed: bookings.creditsUsed,
          bookedAt: bookings.bookedAt,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          cancelled: classes.cancelled,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(bookings.userId, ctx.user.id))
        .orderBy(asc(classes.startsAt));

      const now = new Date();
      return rows.filter((r) =>
        input.includePast ? true : new Date(r.startsAt) >= now,
      );
    }),

  book: protectedProcedure
    .input(z.object({ classId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const cls = await ctx.db
        .select()
        .from(classes)
        .where(eq(classes.id, input.classId))
        .get();

      assertClassIsBookable(cls);

      const existing = await findActiveBooking(ctx.db, cls.id, ctx.user.id);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already on the list for this class.",
        });
      }

      const membership = await findActiveMembership(ctx.db, ctx.user.id);
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "An active membership is required to book classes.",
        });
      }

      if (!canCover(membership, cls.creditCost)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not enough class credits remaining.",
        });
      }

      // Taking the spot and paying for it are one unit of work.
      return ctx.db.transaction(async (tx) => {
        const isFull = (await countConfirmedBookings(tx, cls.id)) >= cls.capacity;

        const created = await tx
          .insert(bookings)
          .values({
            classId: cls.id,
            userId: ctx.user.id,
            membershipId: membership.id,
            status: isFull ? "waitlisted" : "booked",
            creditsUsed: isFull ? 0 : cls.creditCost,
          })
          .returning()
          .get();

        // Waitlisted members are charged when they are promoted, not now.
        if (!isFull) {
          await chargeCredits(tx, membership, cls.creditCost);
        }

        return created;
      });
    }),

  cancel: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ booking: bookings, cls: classes })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(bookings.id, input.bookingId))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      }

      assertCanActOnBooking(row.booking, ctx.user, isStaff(ctx.user.role));

      const refundable = isRefundableCancellation(
        row.booking,
        row.cls,
        FREE_CANCELLATION_HOURS,
      );

      const promoted = await ctx.db.transaction(async (tx) => {
        await tx
          .update(bookings)
          .set({ status: "cancelled", cancelledAt: nowIso() })
          .where(eq(bookings.id, row.booking.id));

        if (refundable && row.booking.membershipId) {
          await refundCredits(tx, row.booking.membershipId, row.booking.creditsUsed);
        }

        // Freeing a confirmed spot promotes whoever has waited longest and can
        // still pay. Giving up a waitlist place frees nothing, so nobody moves.
        return row.booking.status === "booked"
          ? promoteFromWaitlist(tx, row.cls)
          : null;
      });

      if (promoted) {
        await notifyWaitlistPromotion(ctx.db, promoted.userId, row.cls);
      }

      return { ok: true, refunded: refundable };
    }),

  markAttended: staffProcedure
    .input(
      z.object({
        bookingId: z.number(),
        source: checkinSource.default("front_desk"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .get();

      if (!booking) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      }
      if (booking.status !== "booked") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only confirmed bookings can be checked in.",
        });
      }

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(bookings)
          .set({ status: "attended" })
          .where(eq(bookings.id, booking.id));

        await tx.insert(checkins).values({
          userId: booking.userId,
          bookingId: booking.id,
          source: input.source,
        });
      });

      return { ok: true };
    }),

  rosterFor: staffProcedure
    .input(z.object({ classId: z.number() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          bookingId: bookings.id,
          status: bookings.status,
          memberId: users.id,
          memberName: users.name,
          memberEmail: users.email,
          bookedAt: bookings.bookedAt,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.userId, users.id))
        .where(eq(bookings.classId, input.classId))
        .orderBy(asc(bookings.bookedAt));
    }),

  upcomingForMember: staffProcedure
    .input(z.object({ userId: z.number(), hoursAhead: z.number().default(2) }))
    .query(async ({ ctx, input }) => {
      const now = nowIso();
      const futureTime = hoursFromNowIso(input.hoursAhead);

      return ctx.db
        .select({
          bookingId: bookings.id,
          bookingStatus: bookings.status,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          capacity: classes.capacity,
          trainerId: classes.trainerId,
          trainerName: users.name,
        })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .leftJoin(users, eq(classes.trainerId, users.id))
        .where(
          and(
            eq(bookings.userId, input.userId),
            eq(bookings.status, "booked"),
            sql`${classes.startsAt} >= ${now}`,
            sql`${classes.startsAt} <= ${futureTime}`,
            eq(classes.cancelled, false),
          ),
        )
        .orderBy(classes.startsAt);
    }),

  /**
   * Everyone who came through the door for a class, personal and corporate.
   *
   * Corporate check-ins hang off `corporate_booking_id`; personal ones off
   * `booking_id`. Both have to be counted or the trainer's headcount is short.
   */
  checkinCountFor: staffProcedure
    .input(z.object({ classId: z.number() }))
    .query(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(checkins)
        .leftJoin(bookings, eq(checkins.bookingId, bookings.id))
        .leftJoin(
          corporateBookings,
          eq(checkins.corporateBookingId, corporateBookings.id),
        )
        .where(
          or(
            and(isNotNull(checkins.bookingId), eq(bookings.classId, input.classId)),
            and(
              isNotNull(checkins.corporateBookingId),
              eq(corporateBookings.classId, input.classId),
            ),
          ),
        );

      return { count: Number(result?.count ?? 0) };
    }),

  waitlisted: protectedProcedure.query(async ({ ctx }) => {
    const waitlistedBookings = await ctx.db
      .select({
        bookingId: bookings.id,
        classId: classes.id,
        className: classes.name,
        room: classes.room,
        startsAt: classes.startsAt,
        durationMin: classes.durationMin,
        capacity: classes.capacity,
        bookedAt: bookings.bookedAt,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(
        and(eq(bookings.userId, ctx.user.id), eq(bookings.status, "waitlisted")),
      )
      .orderBy(asc(classes.startsAt));

    return Promise.all(
      waitlistedBookings.map(async (entry) => ({
        ...entry,
        position: (await countAheadInQueue(ctx.db, entry.classId, entry.bookingId)) + 1,
      })),
    );
  }),
});

/**
 * How many members are ahead of a given booking in a class's waitlist.
 *
 * Ranks on `(bookedAt, id)` to match the order promotion actually uses.
 * `bookedAt` alone resolves only to the second, so two people who joined in the
 * same second used to be shown the same queue position.
 */
async function countAheadInQueue(db: DbClient, classId: number, bookingId: number) {
  const target = await db
    .select({ bookedAt: bookings.bookedAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .get();

  if (!target) return 0;

  const [{ position }] = await db
    .select({ position: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, classId),
        eq(bookings.status, "waitlisted"),
        or(
          sql`${bookings.bookedAt} < ${target.bookedAt}`,
          and(
            sql`${bookings.bookedAt} = ${target.bookedAt}`,
            sql`${bookings.id} < ${bookingId}`,
          ),
        ),
      ),
    );

  return Number(position);
}
