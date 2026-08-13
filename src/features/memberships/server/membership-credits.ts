import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { memberships, type Membership } from "@/db/schema";
import { todayIso } from "@/lib/datetime";
import { hasUnlimitedCredits, UNLIMITED_CREDITS } from "../credits";

export { hasUnlimitedCredits, UNLIMITED_CREDITS };

/**
 * The membership a member books against: active, not yet ended, and when there
 * is more than one, the furthest-dated.
 */
export function findActiveMembership(db: Database, userId: number) {
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

/** Takes credits for a spot the member has just been given. */
export async function chargeCredits(
  db: Database,
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
  db: Database,
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

/**
 * Takes credits from a member being promoted off a waitlist.
 *
 * Unlike a fresh booking this cannot be refused — the spot has already been
 * given — so a balance that cannot cover the class is floored at zero rather
 * than going negative.
 */
export async function chargeCreditsForPromotion(
  db: Database,
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
    .set({ creditsRemaining: Math.max(0, membership.creditsRemaining - amount) })
    .where(eq(memberships.id, membership.id));
}
