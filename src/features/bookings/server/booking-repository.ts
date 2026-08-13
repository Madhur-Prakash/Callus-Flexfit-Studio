import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db/client";
import { bookings } from "@/db/schema";
import { ACTIVE_BOOKING_STATUSES } from "./booking-policy";

/**
 * How many confirmed spots a class has taken.
 *
 * Counts `attended` as well as `booked`: once the front desk checks someone in
 * they are still occupying the spot. Counting only `booked` made a class look
 * like it had room again as people arrived.
 */
export async function countConfirmedBookings(
  db: DbClient,
  classId: number,
): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, classId),
        inArray(bookings.status, ["booked", "attended"]),
      ),
    );

  return Number(count);
}

/** The member's existing booked-or-waitlisted row for a class, if any. */
export function findActiveBooking(db: DbClient, classId: number, userId: number) {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, classId),
        eq(bookings.userId, userId),
        inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    )
    .get();
}

/**
 * The waitlist for a class, longest wait first.
 *
 * Ordered by id as well as `bookedAt` because `bookedAt` defaults to SQLite's
 * `CURRENT_TIMESTAMP`, which only resolves to the second — two people joining
 * within the same second would otherwise have no defined order.
 */
export function findWaitlist(db: DbClient, classId: number) {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.classId, classId), eq(bookings.status, "waitlisted")))
    .orderBy(asc(bookings.bookedAt), asc(bookings.id));
}

/** Everyone holding a confirmed spot, for when a class is called off. */
export function findConfirmedBookings(db: DbClient, classId: number) {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, classId),
        inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    );
}
