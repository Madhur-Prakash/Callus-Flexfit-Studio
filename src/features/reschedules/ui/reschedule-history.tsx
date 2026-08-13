"use client";

import { Section } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";

type RescheduleRecord = {
  id: number;
  rescheduledAt: string;
  fromClassName: string;
  fromClassTime: string | null;
  fromClassRoom: string | null;
  toClassTime: string | null;
  toClassRoom: string | null;
};

/** Past moves, newest first. Hidden entirely when there are none. */
export function RescheduleHistory({ records }: { records: RescheduleRecord[] }) {
  if (records.length === 0) return null;

  return (
    <Section title="Reschedule history">
      <div className="space-y-2">
        {records.map((record) => (
          <div key={record.id} className="panel p-4">
            <div className="text-sm">
              <p className="font-medium">{record.fromClassName}</p>
              <p className="muted text-xs mt-1">
                From: {formatDateTime(record.fromClassTime ?? "")} • {record.fromClassRoom}
              </p>
              <p className="muted text-xs">
                To: {formatDateTime(record.toClassTime ?? "")} • {record.toClassRoom}
              </p>
              <p className="muted text-xs mt-1">
                Rescheduled {formatDate(record.rescheduledAt)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
