/**
 * Turning an instant into the weekly slot a trainer's availability is recorded
 * against.
 *
 * Availability is stored as a day-of-week plus `HH:MM` strings with no
 * timezone, and is compared against UTC components of the class start. That is
 * only correct for a studio operating on UTC, but changing it would move which
 * classes a trainer is considered free for, so it is preserved as-is.
 */

type WeeklySlot = {
  dayOfWeek: number;
  /** `HH:MM`, UTC. */
  startTime: string;
  endTime: string;
  startsAt: Date;
  endsAt: Date;
};

const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

export function toWeeklySlot(startsAtIso: string, durationMin: number): WeeklySlot {
  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60000);

  return {
    dayOfWeek: startsAt.getUTCDay(),
    startTime: hhmm(startsAt),
    endTime: hhmm(endsAt),
    startsAt,
    endsAt,
  };
}

/** Half-open overlap: classes that merely touch end-to-start do not clash. */
export function overlaps(
  slot: Pick<WeeklySlot, "startsAt" | "endsAt">,
  other: { startsAt: string; durationMin: number },
): boolean {
  const otherStart = new Date(other.startsAt);
  const otherEnd = new Date(otherStart.getTime() + other.durationMin * 60000);

  return slot.startsAt < otherEnd && slot.endsAt > otherStart;
}
