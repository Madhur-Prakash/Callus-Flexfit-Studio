import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "@/db/client";
import { companies, companyMembers, corporateBookings, type Company } from "@/db/schema";
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
export function findActiveCompanyFor(db: DbClient, userId: number) {
  return db
    .select()
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(and(eq(companyMembers.userId, userId), eq(companies.active, true)))
    .get();
}

/** The company behind a booking, but only if its pool can still pay `amount`. */
async function findPayingCompany(
  db: DbClient,
  companyId: number,
  amount: number,
): Promise<Company | null> {
  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .get();

  if (!company || company.creditPoolBalance < amount) return null;
  return company;
}

export async function debitPool(
  db: DbClient,
  company: Pick<Company, "id" | "creditPoolBalance">,
  amount: number,
): Promise<void> {
  await db
    .update(companies)
    .set({ creditPoolBalance: company.creditPoolBalance - amount })
    .where(eq(companies.id, company.id));
}

/** Returns credits from a cancelled booking to the employer's pool. */
export async function refundToPool(
  db: DbClient,
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

// --- corporate booking queries -------------------------------------------
// Same shape as the personal-booking queries, but a different table with a
// different credit source. Kept separate rather than made generic: the two
// sets are each a handful of lines, and a shared abstraction over both tables
// would hide which pool is being spent.
//
// "Is the class full" and "is this member already on it" are *not* here:
// both span the two booking tables, so they live in
// `features/classes/server/class-capacity.ts` and are answered once.

/** The corporate waitlist for a class, longest wait first. */
function findCorporateWaitlist(db: DbClient, classId: number) {
  return db
    .select()
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, classId),
        eq(corporateBookings.status, "waitlisted"),
      ),
    )
    .orderBy(asc(corporateBookings.bookedAt), asc(corporateBookings.id));
}

/** Everyone holding an active corporate spot, for when a class is called off. */
export function findActiveCorporateBookings(db: DbClient, classId: number) {
  return db
    .select()
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, classId),
        inArray(corporateBookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    );
}

/**
 * Moves a corporate member off the waitlist into a freed spot.
 *
 * Mirrors the personal-booking rule: the longest-waiting member whose employer
 * can still pay gets the spot, and anyone whose pool has run dry is passed
 * over. Previously the promotion went ahead and the pool was simply not
 * charged, so the class was given away free.
 */
export async function promoteFromCorporateWaitlist(
  db: DbClient,
  cls: { id: number; creditCost: number },
) {
  const queue = await findCorporateWaitlist(db, cls.id);

  for (const candidate of queue) {
    // Same rule as personal bookings: only bill what is still outstanding, so
    // a booking that already paid is not charged twice.
    const outstanding = Math.max(0, cls.creditCost - candidate.creditsUsed);
    const creditsUsed = candidate.creditsUsed + outstanding;

    if (outstanding > 0) {
      const company = await findPayingCompany(db, candidate.companyId, outstanding);
      if (!company) continue;

      await db
        .update(corporateBookings)
        .set({ status: "booked", creditsUsed })
        .where(eq(corporateBookings.id, candidate.id));

      await debitPool(db, company, outstanding);
    } else {
      await db
        .update(corporateBookings)
        .set({ status: "booked", creditsUsed })
        .where(eq(corporateBookings.id, candidate.id));
    }

    return { ...candidate, status: "booked" as const, creditsUsed };
  }

  return null;
}
