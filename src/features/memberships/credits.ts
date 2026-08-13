/**
 * The unlimited-plan convention, in a module with no dependencies so both the
 * server and the browser can use it.
 *
 * Plans at or above this balance are treated as unlimited: never debited,
 * never refunded, and shown as "Unlimited" rather than as a number. The seeded
 * unlimited plans all carry exactly 999 credits, which is how the app tells
 * them apart from a credit pack.
 */
export const UNLIMITED_CREDITS = 999;

export function hasUnlimitedCredits(creditsRemaining: number): boolean {
  return creditsRemaining >= UNLIMITED_CREDITS;
}
