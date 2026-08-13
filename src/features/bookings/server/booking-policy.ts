import { TRPCError } from "@trpc/server";
import { hoursUntil } from "@/lib/datetime";
import type { Booking, GymClass } from "@/db/schema";

/**
 * Members may cancel free of charge up to this many hours before the class
 * starts. Cancelling later still frees the spot but forfeits the credit.
 */
export const FREE_CANCELLATION_HOURS = 12;

/** The two states a member can still act on. */
export const ACTIVE_BOOKING_STATUSES = ["booked", "waitlisted"] as const;

export function isActiveBooking(booking: Pick<Booking, "status">): boolean {
  return (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(booking.status);
}

/** Whether cancelling now returns the credits the booking spent. */
export function isRefundableCancellation(
  booking: Pick<Booking, "creditsUsed">,
  cls: Pick<GymClass, "startsAt">,
  freeCancellationHours: number,
): boolean {
  return hoursUntil(cls.startsAt) >= freeCancellationHours && booking.creditsUsed > 0;
}

/**
 * The checks every booking attempt makes about the class itself, shared by
 * personal and corporate bookings. Throws with the caller-facing message.
 */
export function assertClassIsBookable(cls: GymClass | undefined): asserts cls is GymClass {
  if (!cls) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
  }
  if (cls.cancelled) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This class has been cancelled.",
    });
  }
  if (hoursUntil(cls.startsAt) <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This class has already started.",
    });
  }
}

export function assertCanActOnBooking(
  booking: Pick<Booking, "userId" | "status">,
  actor: { id: number; role: string },
  isStaffActor: boolean,
): void {
  const isOwner = booking.userId === actor.id;
  if (!isOwner && !isStaffActor) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot cancel this booking.",
    });
  }
  if (!isActiveBooking(booking)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This booking is no longer active.",
    });
  }
}
