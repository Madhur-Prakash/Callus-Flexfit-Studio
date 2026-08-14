import { and, desc, eq, sql } from "drizzle-orm";
import type { DbClient } from "@/db/client";
import { memberships, type Membership } from "@/db/schema";
import { todayIso } from "@/lib/datetime";
import { hasUnlimitedCredits } from "../credits";


/**
 * The membership a member books against: active, not yet ended, and when there
 * is more than one, the furthest-dated.
 */
export function findActiveMembership(db: DbClient, userId: number) {
  const today = todayIso();
  return db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        sql`${memberships.endDate} >= ${today}`,
      ),
    )
    .orderBy(desc(memberships.endDate))
    .get();
}

export function canCover(membership: Membership, amount: number): boolean {
  return hasUnlimitedCredits(membership.creditsRemaining) ||
    membership.creditsRemaining >= amount;
}

/**
 * The membership behind a booking, but only if it can still pay `amount`.
 *
 * Used when promoting off a waitlist, where a member who can no longer afford
 * the class is passed over rather than being charged what little they have.
 */
export async function findChargeableMembership(
  db: DbClient,
  membershipId: number | null,
  amount: number,
): Promise<Membership | null> {
  if (membershipId === null) return null;

  const membership = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .get();

  if (!membership) return null;
  return canCover(membership, amount) ? membership : null;
}

/** Takes credits for a spot the member has just been given. */
export async function chargeCredits(
  db: DbClient,
  membership: Membership,
  amount: number,
): Promise<void> {
  if (hasUnlimitedCredits(membership.creditsRemaining)) return;

  await db
    .update(memberships)
    .set({ creditsRemaining: membership.creditsRemaining - amount })
    .where(eq(memberships.id, membership.id));
}

/**
 * Gives back credits a cancelled booking had spent.
 *
 * Re-reads the membership because the caller only holds the booking row, and
 * skips unlimited plans so a refund cannot push a 999 balance higher.
 */
export async function refundCredits(
  db: DbClient,
  membershipId: number,
  amount: number,
): Promise<void> {
  const membership = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .get();

  if (!membership || hasUnlimitedCredits(membership.creditsRemaining)) return;

  await db
    .update(memberships)
    .set({ creditsRemaining: membership.creditsRemaining + amount })
    .where(eq(memberships.id, membership.id));
}
