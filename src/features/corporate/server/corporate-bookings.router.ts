import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { checkins, classes, companies, corporateBookings, users } from "@/db/schema";
import { nowIso } from "@/lib/datetime";
import { isStaff } from "@/lib/roles";
import {
  assertCanActOnBooking,
  assertClassIsBookable,
  isRefundableCancellation,
} from "@/features/bookings/server/booking-policy";
import { notifyWaitlistPromotion } from "@/features/notifications/server/notify";
import { router, protectedProcedure, staffProcedure } from "@/server/trpc/procedures";
import {
  CORPORATE_FREE_CANCELLATION_HOURS,
  countConfirmedCorporateBookings,
  debitPool,
  findActiveCompanyFor,
  findActiveCorporateBooking,
  promoteFromCorporateWaitlist,
  refundToPool,
} from "./company-credits";

export { CORPORATE_FREE_CANCELLATION_HOURS };

export const corporateBookingsRouter = router({
  mine: protectedProcedure
    .input(z.object({ includePast: z.boolean().default(false) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: corporateBookings.id,
          status: corporateBookings.status,
          creditsUsed: corporateBookings.creditsUsed,
          bookedAt: corporateBookings.bookedAt,
          classId: classes.id,
          className: classes.name,
          room: classes.room,
          startsAt: classes.startsAt,
          durationMin: classes.durationMin,
          cancelled: classes.cancelled,
          companyName: companies.name,
        })
        .from(corporateBookings)
        .innerJoin(classes, eq(corporateBookings.classId, classes.id))
        .innerJoin(companies, eq(corporateBookings.companyId, companies.id))
        .where(eq(corporateBookings.userId, ctx.user.id))
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

      const existing = await findActiveCorporateBooking(ctx.db, cls.id, ctx.user.id);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already on the list for this class.",
        });
      }

      const companyRow = await findActiveCompanyFor(ctx.db, ctx.user.id);
      if (!companyRow) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not linked to an active company.",
        });
      }

      const company = companyRow.companies;
      if (company.creditPoolBalance < cls.creditCost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your company does not have enough credits.",
        });
      }

      return ctx.db.transaction(async (tx) => {
        const isFull =
          (await countConfirmedCorporateBookings(tx, cls.id)) >= cls.capacity;

        const created = await tx
          .insert(corporateBookings)
          .values({
            classId: cls.id,
            userId: ctx.user.id,
            companyId: company.id,
            status: isFull ? "waitlisted" : "booked",
            creditsUsed: isFull ? 0 : cls.creditCost,
          })
          .returning()
          .get();

        // Waitlisted spots are charged on promotion, not now.
        if (!isFull) {
          await debitPool(tx, company, cls.creditCost);
        }

        return created;
      });
    }),

  cancel: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ booking: corporateBookings, cls: classes })
        .from(corporateBookings)
        .innerJoin(classes, eq(corporateBookings.classId, classes.id))
        .where(eq(corporateBookings.id, input.bookingId))
        .get();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      }

      assertCanActOnBooking(row.booking, ctx.user, isStaff(ctx.user.role));

      const refundable = isRefundableCancellation(
        row.booking,
        row.cls,
        CORPORATE_FREE_CANCELLATION_HOURS,
      );

      const promoted = await ctx.db.transaction(async (tx) => {
        await tx
          .update(corporateBookings)
          .set({ status: "cancelled", cancelledAt: nowIso() })
          .where(eq(corporateBookings.id, row.booking.id));

        if (refundable) {
          await refundToPool(tx, row.booking.companyId, row.booking.creditsUsed);
        }

        return row.booking.status === "booked"
          ? promoteFromCorporateWaitlist(tx, row.cls)
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
        source: z.enum(["front_desk", "kiosk", "app"]).default("front_desk"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.db
        .select()
        .from(corporateBookings)
        .where(eq(corporateBookings.id, input.bookingId))
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
          .update(corporateBookings)
          .set({ status: "attended" })
          .where(eq(corporateBookings.id, booking.id));

        await tx.insert(checkins).values({
          userId: booking.userId,
          corporateBookingId: booking.id,
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
          bookingId: corporateBookings.id,
          status: corporateBookings.status,
          memberId: users.id,
          memberName: users.name,
          memberEmail: users.email,
          bookedAt: corporateBookings.bookedAt,
          companyName: companies.name,
        })
        .from(corporateBookings)
        .innerJoin(users, eq(corporateBookings.userId, users.id))
        .innerJoin(companies, eq(corporateBookings.companyId, companies.id))
        .where(eq(corporateBookings.classId, input.classId))
        .orderBy(asc(corporateBookings.bookedAt));
    }),
});
