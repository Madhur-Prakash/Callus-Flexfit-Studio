import { eq } from "drizzle-orm";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/unstable-core-do-not-import";
import type { Database } from "@/db/client";
import { bookings, classes, type Booking, type GymClass } from "@/db/schema";
import { hoursUntil } from "@/lib/datetime";
import { isActiveBooking } from "@/features/bookings/server/booking-policy";
import {
  countConfirmedBookings,
  findActiveBooking,
} from "@/features/bookings/server/booking-repository";

/**
 * Members may reschedule free of charge up to this many hours before the
 * original class starts. This is more generous than the cancellation policy.
 */
export const FREE_RESCHEDULE_HOURS = 4;

type Rejection = {
  ok: false;
  /** The code the mutation throws; the dry run drops it and keeps `reason`. */
  code: TRPC_ERROR_CODE_KEY;
  reason: string;
};

type Approval = {
  ok: true;
  booking: Booking;
  fromClass: GymClass;
  toClass: GymClass;
  targetIsFull: boolean;
};

export type RescheduleEvaluation = Rejection | Approval;

const reject = (code: TRPC_ERROR_CODE_KEY, reason: string): Rejection => ({
  ok: false,
  code,
  reason,
});

/**
 * Decides whether a member may move a booking to another class.
 *
 * This is the single source of truth for the rule set. `reschedules.reschedule`
 * turns a rejection into a thrown TRPCError and `reschedules.validateReschedule`
 * returns it as `{ valid: false, reason }` — so the button the member sees
 * disabled and the error they would have got say exactly the same thing.
 *
 * The order of the checks is part of the contract: when a request breaks more
 * than one rule, the member is told about the first one in this list.
 */
export async function evaluateReschedule(
  db: Database,
  userId: number,
  input: { fromBookingId: number; toClassId: number },
): Promise<RescheduleEvaluation> {
  const original = await db
    .select({ booking: bookings, cls: classes })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(eq(bookings.id, input.fromBookingId))
    .get();

  if (!original) {
    return reject("NOT_FOUND", "Booking not found.");
  }

  const { booking, cls: fromClass } = original;

  if (booking.userId !== userId) {
    return reject("FORBIDDEN", "You cannot reschedule this booking.");
  }

  if (!isActiveBooking(booking)) {
    return reject("BAD_REQUEST", "This booking is no longer active.");
  }

  if (hoursUntil(fromClass.startsAt) < FREE_RESCHEDULE_HOURS) {
    return reject(
      "BAD_REQUEST",
      `You can only reschedule up to ${FREE_RESCHEDULE_HOURS} hours before the class starts.`,
    );
  }

  const toClass = await db
    .select()
    .from(classes)
    .where(eq(classes.id, input.toClassId))
    .get();

  if (!toClass) {
    return reject("NOT_FOUND", "Target class not found.");
  }

  // A reschedule is a move within the same offering, not a swap to a different
  // class, so the name has to match.
  if (toClass.name !== fromClass.name) {
    return reject("BAD_REQUEST", "You can only reschedule to a class with the same name.");
  }

  if (toClass.id === fromClass.id) {
    return reject("BAD_REQUEST", "You are already booked for this class.");
  }

  if (hoursUntil(toClass.startsAt) <= 0) {
    return reject("BAD_REQUEST", "This class has already started.");
  }

  if (toClass.cancelled) {
    return reject("BAD_REQUEST", "This class has been cancelled.");
  }

  const existing = await findActiveBooking(db, toClass.id, userId);
  if (existing) {
    return reject("CONFLICT", "You already have an active booking for this class.");
  }

  const targetIsFull = (await countConfirmedBookings(db, toClass.id)) >= toClass.capacity;

  return { ok: true, booking, fromClass, toClass, targetIsFull };
}
