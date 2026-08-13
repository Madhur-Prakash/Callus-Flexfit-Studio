"use client";

import { useState } from "react";
import { SubtleButton, SubtleInput, color } from "@/components/ui";
import { trpc } from "@/lib/trpc/client";

/** Indexed by `dayOfWeek`, which the database stores as 0 = Sunday. */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type Availability = { dayOfWeek: number; startTime: string; endTime: string };

/** The trainer's weekly working hours: one editable window per day. */
export function AvailabilityEditor({ availability }: { availability: Availability[] }) {
  const utils = trpc.useUtils();

  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const setAvailability = trpc.trainers.setAvailability.useMutation({
    onSuccess: async () => {
      await utils.trainers.availability.invalidate();
      stopEditing();
    },
  });

  const removeAvailability = trpc.trainers.removeAvailability.useMutation({
    onSuccess: async () => {
      await utils.trainers.availability.invalidate();
    },
  });

  const byDay = new Map(availability.map((a) => [a.dayOfWeek, a]));

  function stopEditing() {
    setEditingDay(null);
    setStartTime("");
    setEndTime("");
  }

  function startEditing(day: number) {
    const existing = byDay.get(day);
    setEditingDay(day);
    setStartTime(existing?.startTime ?? "");
    setEndTime(existing?.endTime ?? "");
  }

  return (
    <div className="space-y-2">
      {WEEKDAYS.map((dayName, day) => {
        const existing = byDay.get(day);
        const isEditing = editingDay === day;

        return (
          <div key={day} className="panel p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="font-medium">{dayName}</div>
                {existing && !isEditing && (
                  <div className="muted mt-1 text-sm">
                    {existing.startTime} - {existing.endTime}
                  </div>
                )}
              </div>

              <div className="ml-4 flex gap-2">
                {isEditing ? (
                  <>
                    <SubtleInput
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="rounded border px-2 py-1 text-sm"
                    />
                    <SubtleInput
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="rounded border px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => {
                        if (!startTime || !endTime) return;
                        setAvailability.mutate({ dayOfWeek: day, startTime, endTime });
                      }}
                      disabled={setAvailability.isPending || !startTime || !endTime}
                      className="btn btn-primary btn-sm"
                    >
                      Save
                    </button>
                    <SubtleButton onClick={() => setEditingDay(null)}>Cancel</SubtleButton>
                  </>
                ) : (
                  <>
                    <SubtleButton onClick={() => startEditing(day)}>
                      {existing ? "Edit" : "Add"}
                    </SubtleButton>
                    {existing && (
                      <SubtleButton
                        onClick={() => removeAvailability.mutate({ dayOfWeek: day })}
                        disabled={removeAvailability.isPending}
                        color={color.dangerStrong}
                      >
                        Remove
                      </SubtleButton>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
