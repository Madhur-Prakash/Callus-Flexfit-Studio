"use client";

import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

type ScheduleClass = {
  id: number;
  name: string;
  room: string;
  startsAt: string;
  durationMin: number;
  creditCost: number;
  capacity: number;
  spotsLeft: number;
  full: boolean;
  trainerName: string | null;
};

/** One class on the public schedule, with its booking control. */
export function ClassRow({
  cls,
  disabled,
  onBook,
}: {
  cls: ScheduleClass;
  disabled: boolean;
  onBook: () => void;
}) {
  return (
    <div className="panel flex items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="font-medium">{cls.name}</h2>
          {cls.full && <Badge>Full</Badge>}
        </div>
        <p className="muted mt-0.5 text-sm">
          {formatDateTime(cls.startsAt)} &middot; {cls.room} &middot;{" "}
          {cls.trainerName ?? "Unassigned"} &middot; {cls.durationMin} min
        </p>
      </div>

      <div className="text-right text-sm muted">
        <div>
          {cls.spotsLeft} / {cls.capacity} left
        </div>
        <div>
          {cls.creditCost} credit{cls.creditCost === 1 ? "" : "s"}
        </div>
      </div>

      <button className="btn btn-primary" disabled={disabled} onClick={onBook}>
        {cls.full ? "Join waitlist" : "Book"}
      </button>
    </div>
  );
}
