import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { bookings } from "@/db/schema";
import { ACTIVE_BOOKING_STATUSES } from "./booking-policy";

/**
 * How many confirmed spots a class has taken. Waitlisted rows do not count
 * towards capacity.
 */
export async function countConfirmedBookings(
  db: Database,
  classId: number,
): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(and(eq(bookings.classId, classId), eq(bookings.status, "booked")));

  return Number(count);
}

/** The member's existing booked-or-waitlisted row for a class, if any. */
export function findActiveBooking(db: Database, classId: number, userId: number) {
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

/** The member who has waited longest for a spot on a class. */
export function findNextWaitlisted(db: Database, classId: number) {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.classId, classId), eq(bookings.status, "waitlisted")))
    .orderBy(asc(bookings.bookedAt))
    .get();
}
