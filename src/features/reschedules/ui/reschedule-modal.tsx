"use client";

import { useState } from "react";
import { Badge, color } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useNowIso } from "@/lib/hooks/use-now-iso";
import { trpc } from "@/lib/trpc/client";

type RescheduleTarget = {
  bookingId: number;
  classId: number;
  className: string;
  classTime: string;
};

export function RescheduleModal({
  target,
  onClose,
  onSuccess,
}: {
  /** Null when closed. */
  target: RescheduleTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: availableClasses } = trpc.classes.list.useQuery(
    { from: useNowIso() },
    { enabled: target !== null },
  );

  const reschedule = trpc.reschedules.reschedule.useMutation({
    onSuccess: async () => {
      await utils.bookings.mine.invalidate();
      await utils.bookings.waitlisted.invalidate();
      await utils.reschedules.history.invalidate();
      await utils.classes.list.invalidate();
      setSelectedClassId(null);
      onClose();
      onSuccess();
    },
    onError: (err) => setError(err.message),
  });

  if (!target) return null;

  // The server only accepts a move to a class of the same name, so the picker
  // never offers anything else — and never offers the class the member is
  // already booked on, which the server rejects with "You are already booked
  // for this class."
  const sameNameClasses = (availableClasses ?? []).filter(
    (cls) => cls.name === target.className && cls.id !== target.classId,
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        className="panel space-y-4 p-6"
        style={{ maxWidth: "500px", width: "90%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold">Reschedule class</h2>
          <p className="muted mt-1 text-sm">
            Moving: {target.className} on {formatDateTime(target.classTime)}
          </p>
        </div>

        {error && <p style={{ color: color.danger, fontSize: "0.875rem" }}>{error}</p>}

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {sameNameClasses.length ? (
            sameNameClasses.map((cls) => (
              <button
                key={cls.id}
                className="panel w-full p-3 text-left"
                onClick={() => setSelectedClassId(cls.id)}
                style={{
                  border:
                    selectedClassId === cls.id
                      ? "2px solid #3b82f6"
                      : "1px solid transparent",
                }}
                disabled={reschedule.isPending}
              >
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm">{cls.name}</h3>
                  {(cls.full || (cls.spotsLeft ?? 0) === 0) && <Badge>Waitlist</Badge>}
                </div>
                <p className="muted text-xs mt-1">
                  {formatDateTime(cls.startsAt)} • {cls.room}
                </p>
              </button>
            ))
          ) : (
            <p className="muted text-sm text-center py-4">
              No other {target.className} classes available
            </p>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button className="btn" disabled={reschedule.isPending} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!selectedClassId || reschedule.isPending}
            onClick={() => {
              if (selectedClassId) {
                reschedule.mutate({
                  fromBookingId: target.bookingId,
                  toClassId: selectedClassId,
                });
              }
            }}
          >
            {reschedule.isPending ? "Rescheduling..." : "Reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type { RescheduleTarget };
