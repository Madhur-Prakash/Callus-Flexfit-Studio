import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db/client";
import { bookings, corporateBookings, type GymClass } from "@/db/schema";
import { ACTIVE_BOOKING_STATUSES } from "@/features/bookings/server/booking-policy";

/**
 * A class's capacity, counted across both ways of booking it.
 *
 * Members book through `bookings`, employees of a corporate client through
 * `corporate_bookings`. They are separate tables but the same room: one person
 * per spot, whichever door they came through.
 *
 * Each feature used to count only its own table, so a class of capacity 10
 * could take 10 personal bookings *and* 10 corporate ones. This module is the
 * single answer to "is there room", and both booking paths go through it.
 */

const OCCUPYING_STATUSES = ["booked", "attended"] as const;

/** Confirmed spots taken, personal plus corporate. */
export async function countConfirmedSpots(
  db: DbClient,
  classId: number,
): Promise<number> {
  const [personal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, classId),
        inArray(bookings.status, [...OCCUPYING_STATUSES]),
      ),
    );

  const [corporate] = await db
    .select({ count: sql<number>`count(*)` })
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, classId),
        inArray(corporateBookings.status, [...OCCUPYING_STATUSES]),
      ),
    );

  return Number(personal.count) + Number(corporate.count);
}

export async function isClassFull(
  db: DbClient,
  cls: Pick<GymClass, "id" | "capacity">,
): Promise<boolean> {
  return (await countConfirmedSpots(db, cls.id)) >= cls.capacity;
}

/**
 * Whether this member already holds a live place on a class, by either route.
 *
 * Without this, someone linked to a corporate account could book the same class
 * personally *and* through their employer, taking two spots and paying twice.
 */
export async function findExistingParticipation(
  db: DbClient,
  classId: number,
  userId: number,
): Promise<"personal" | "corporate" | null> {
  const personal = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, classId),
        eq(bookings.userId, userId),
        inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    )
    .get();

  if (personal) return "personal";

  const corporate = await db
    .select({ id: corporateBookings.id })
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, classId),
        eq(corporateBookings.userId, userId),
        inArray(corporateBookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    )
    .get();

  return corporate ? "corporate" : null;
}
