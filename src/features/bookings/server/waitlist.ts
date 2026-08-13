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
    const membership = await findChargeableMembership(
      db,
      candidate.membershipId,
      cls.creditCost,
    );
    if (!membership) continue;

    await db
      .update(bookings)
      .set({ status: "booked", creditsUsed: cls.creditCost })
      .where(eq(bookings.id, candidate.id));

    await chargeCredits(db, membership, cls.creditCost);

    return { ...candidate, status: "booked", creditsUsed: cls.creditCost };
  }

  return null;
}
