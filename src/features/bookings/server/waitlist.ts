import { eq } from "drizzle-orm";
import type { DbClient } from "@/db/client";
import { bookings, type Booking, type GymClass } from "@/db/schema";
import {
  chargeCredits,
  findChargeableMembership,
} from "@/features/memberships/server/membership-credits";
import { findWaitlist } from "./booking-repository";

/**
 * Moves someone off the waitlist into a spot that has just been freed.
 *
 * Takes the longest-waiting member who can still pay for the class, skipping
 * anyone who cannot. Skipping matters: a member who no longer has the credits
 * could not book this class through the front door either, so handing them the
 * spot and taking whatever happens to be left in their balance is worse than
 * passing to the next person. If nobody in the queue can pay, the spot simply
 * stays open.
 *
 * Returns the promoted booking so the caller can notify them, or null.
 */
export async function promoteFromWaitlist(
  db: DbClient,
  cls: Pick<GymClass, "id" | "creditCost">,
): Promise<Booking | null> {
  const queue = await findWaitlist(db, cls.id);

  for (const candidate of queue) {
    // A waitlist place normally costs nothing, so the full price is due on
    // promotion. But a booking that arrived here by rescheduling carries the
    // credits it already paid, and charging the full price again would bill
    // the member twice for one class.
    const outstanding = Math.max(0, cls.creditCost - candidate.creditsUsed);
    const creditsUsed = candidate.creditsUsed + outstanding;

    if (outstanding > 0) {
      const membership = await findChargeableMembership(
        db,
        candidate.membershipId,
        outstanding,
      );
      if (!membership) continue;

      await db
        .update(bookings)
        .set({ status: "booked", creditsUsed })
        .where(eq(bookings.id, candidate.id));

      await chargeCredits(db, membership, outstanding);
    } else {
      await db
        .update(bookings)
        .set({ status: "booked", creditsUsed })
        .where(eq(bookings.id, candidate.id));
    }

    return { ...candidate, status: "booked", creditsUsed };
  }

  return null;
}
