"use client";

import { DangerTag } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc/client";

type TrainerClass = {
  id: number;
  name: string;
  room: string;
  startsAt: string;
  durationMin: number;
  cancelled: boolean;
};

/**
 * One class on the trainer's list, with how many people booked and how many
 * actually came through the door.
 */
export function TrainerClassCard({ cls }: { cls: TrainerClass }) {
  const { data: roster, isLoading: rosterLoading } = trpc.bookings.rosterFor.useQuery({
    classId: cls.id,
  });
  const { data: checkinData, isLoading: checkinLoading } =
    trpc.bookings.checkinCountFor.useQuery({ classId: cls.id });

  const bookedCount =
    roster?.filter((r) => r.status === "booked" || r.status === "attended").length ?? 0;
  const checkins = checkinData?.count ?? 0;

  return (
    <div className="p-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{cls.name}</div>
          <div className="muted mt-1 text-xs">
            {formatDateTime(cls.startsAt)} · {cls.room} · {cls.durationMin} min
          </div>
          {!rosterLoading && !checkinLoading && (
            <div className="muted mt-2 text-xs">
              📊 {bookedCount} booked · ✓ {checkins} checked in
            </div>
          )}
          {cls.cancelled && <DangerTag>Cancelled</DangerTag>}
        </div>
      </div>
    </div>
  );
}
