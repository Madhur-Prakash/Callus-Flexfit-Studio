"use client";

import { formatDateTime } from "@/lib/format";

type Booking = {
  id: number;
  className: string;
  status: string;
  startsAt: string;
  room: string;
};

/**
 * One of the member's bookings. Reschedule is offered only for confirmed
 * bookings; a waitlist place can be given up but not moved.
 */
export function BookingRow({
  booking,
  busy,
  onReschedule,
  onCancel,
}: {
  booking: Booking;
  busy: boolean;
  onReschedule: () => void;
  onCancel: () => void;
}) {
  const isActive = booking.status === "booked" || booking.status === "waitlisted";

  return (
    <div className="panel flex items-center gap-2 p-4 flex-wrap sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">{booking.className}</h3>
          <span className="muted text-xs uppercase tracking-wide">{booking.status}</span>
        </div>
        <p className="muted mt-0.5 text-sm">
          {formatDateTime(booking.startsAt)} &middot; {booking.room}
        </p>
      </div>

      {isActive && (
        <div className="flex gap-2 w-full sm:w-auto">
          {booking.status === "booked" && (
            <button
              className="btn text-sm flex-1 sm:flex-none"
              disabled={busy}
              onClick={onReschedule}
            >
              Reschedule
            </button>
          )}
          <button
            className="btn text-sm flex-1 sm:flex-none"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
