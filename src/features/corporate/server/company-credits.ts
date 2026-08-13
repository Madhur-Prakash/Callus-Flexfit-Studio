import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { companies, companyMembers, corporateBookings } from "@/db/schema";
import { ACTIVE_BOOKING_STATUSES } from "@/features/bookings/server/booking-policy";

/**
 * Corporate members may cancel free of charge up to this many hours before
 * the class starts — twice the window personal bookings get, because the
 * credit returns to a shared pool the employer paid for.
 */
export const CORPORATE_FREE_CANCELLATION_HOURS = 24;

/**
 * The active company a member books against.
 *
 * Returns the joined shape (`{ company_members, companies }`), because callers
 * need the company row itself.
 */
export function findActiveCompanyFor(db: Database, userId: number) {
  return db
    .select()
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(and(eq(companyMembers.userId, userId), eq(companies.active, true)))
    .get();
}

export async function debitPool(
  db: Database,
  company: { id: number; creditPoolBalance: number },
  amount: number,
): Promise<void> {
  await db
    .update(companies)
    .set({ creditPoolBalance: company.creditPoolBalance - amount })
    .where(eq(companies.id, company.id));
}

/** Returns credits from a cancelled booking to the employer's pool. */
export async function refundToPool(
  db: Database,
  companyId: number,
  amount: number,
): Promise<void> {
  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .get();

  if (!company) return;

  await db
    .update(companies)
    .set({ creditPoolBalance: company.creditPoolBalance + amount })
    .where(eq(companies.id, company.id));
}

/**
 * Charges a pool for a member promoted off the waitlist.
 *
 * If the pool can no longer cover the class the promotion still stands and the
 * balance is left alone — the employee keeps the spot they were given.
 */
export async function chargePoolForPromotion(
  db: Database,
  companyId: number,
  amount: number,
): Promise<void> {
  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .get();

  if (!company || company.creditPoolBalance < amount) return;

  await db
    .update(companies)
    .set({ creditPoolBalance: Math.max(0, company.creditPoolBalance - amount) })
    .where(eq(companies.id, company.id));
}

// --- corporate booking queries -------------------------------------------
// Same shape as the personal-booking queries, but a different table with a
// different credit source. Kept separate rather than made generic: the two
// sets are each a handful of lines, and a shared abstraction over both tables
// would hide which pool is being spent.

export async function countConfirmedCorporateBookings(
  db: Database,
  classId: number,
): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, classId),
        eq(corporateBookings.status, "booked"),
      ),
    );

  return Number(count);
}

export function findActiveCorporateBooking(
  db: Database,
  classId: number,
  userId: number,
) {
  return db
    .select()
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, classId),
        eq(corporateBookings.userId, userId),
        inArray(corporateBookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    )
    .get();
}

export function findNextWaitlistedCorporate(db: Database, classId: number) {
  return db
    .select()
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, classId),
        eq(corporateBookings.status, "waitlisted"),
      ),
    )
    .orderBy(asc(corporateBookings.bookedAt))
    .get();
}
