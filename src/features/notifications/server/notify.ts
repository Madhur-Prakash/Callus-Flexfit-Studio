import type { DbClient } from "@/db/client";
import { notifications, type GymClass } from "@/db/schema";
import { formatDateTime } from "@/lib/format";

/**
 * Raising a notification for something that happened to a member.
 *
 * The `notifications` table has always declared four types, but until now only
 * `announcement` was ever written — a member promoted off a waitlist or booked
 * onto a class the studio then cancelled was never told. These are the events
 * that produce the other two.
 *
 * Every function here is best-effort from the caller's point of view: telling
 * someone about a promotion must never undo the promotion. Callers run them
 * after the transaction that did the real work.
 */

export async function notifyWaitlistPromotion(
  db: DbClient,
  userId: number,
  cls: Pick<GymClass, "name" | "startsAt">,
): Promise<void> {
  await db.insert(notifications).values({
    userId,
    type: "waitlist_promotion",
    title: "You're off the waitlist",
    message: `A spot opened up in ${cls.name} on ${formatDateTime(cls.startsAt)} and it's yours. Your credits have been charged.`,
  });
}

export async function notifyClassCancelled(
  db: DbClient,
  userIds: number[],
  cls: Pick<GymClass, "name" | "startsAt">,
): Promise<void> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;

  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      type: "class_cancelled" as const,
      title: "Class cancelled",
      message: `${cls.name} on ${formatDateTime(cls.startsAt)} has been cancelled. Any credits you spent have been returned.`,
    })),
  );
}
