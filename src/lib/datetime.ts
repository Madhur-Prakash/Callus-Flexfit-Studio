/**
 * Date helpers shared by the server modules.
 *
 * The studio stores timestamps as ISO strings and dates as `YYYY-MM-DD`, and
 * compares them with SQLite string comparison. Several of the helpers below mix
 * UTC and local-time arithmetic. That is not tidy, but it is what the app has
 * always done, and the two styles disagree by a day near midnight in a non-UTC
 * timezone, so they are kept as separate, explicitly named functions rather
 * than being "unified" into one.
 */

/** Fractional hours from `now` until `iso`. Negative once `iso` has passed. */
export function hoursUntil(iso: string, now = new Date()): number {
  return (new Date(iso).getTime() - now.getTime()) / 36e5;
}

/** Current instant as a full ISO timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Today as `YYYY-MM-DD`, in UTC. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `days` after `dateIso`, as `YYYY-MM-DD`.
 *
 * Uses local-time `setDate`, so for a caller in a positive UTC offset the
 * result is the local calendar day. Membership end dates are computed this way.
 */
export function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * `days` before today as `YYYY-MM-DD`, via local-time `setDate`.
 * Used for the rolling 14-day report windows.
 */
export function daysAgoIso(days: number): string {
  const start = new Date();
  start.setDate(start.getDate() - days);
  return start.toISOString().slice(0, 10);
}

/**
 * `days` after now as `YYYY-MM-DD`, via millisecond arithmetic.
 *
 * Deliberately distinct from `addDays`: the expiring-memberships report has
 * always used this form, and the two can differ by a day.
 */
export function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** An ISO timestamp `hours` from now. */
export function hoursFromNowIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
