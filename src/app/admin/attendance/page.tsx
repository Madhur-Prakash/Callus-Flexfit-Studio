"use client";

import {
  AccessDenied,
  EmptyNote,
  LoadingMessage,
  PageHeader,
  PanelList,
  Section,
  StatTile,
} from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { isAdmin } from "@/lib/roles";
import { trpc } from "@/lib/trpc/client";

export default function AdminAttendancePage() {
  const { user } = useCurrentUser();

  const { data: checkinsPerDay, isLoading: checkinsLoading } =
    trpc.admin.checkinsPerDay.useQuery();
  const { data: topTrainers, isLoading: trainersLoading } =
    trpc.admin.topTrainers.useQuery();
  const { data: noShowList, isLoading: noShowLoading } = trpc.admin.noShowList.useQuery();

  if (!isAdmin(user?.role)) {
    return <AccessDenied audience="Admins only." />;
  }

  if (checkinsLoading || trainersLoading || noShowLoading) {
    return <LoadingMessage>Loading attendance data...</LoadingMessage>;
  }

  const totalCheckins = (checkinsPerDay ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Attendance"
        subtitle="Last 14 days of check-ins and class attendance"
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Total Check-ins (14d)" value={totalCheckins} />
        <StatTile
          label="Top Trainer"
          value={topTrainers?.length ? topTrainers[0].trainerName : "N/A"}
        />
        <StatTile label="No-shows (14d)" value={noShowList?.length ?? 0} />
      </section>

      <Section title="Check-ins by Day (Last 14 Days)">
        {checkinsPerDay && checkinsPerDay.length > 0 ? (
          <PanelList>
            {checkinsPerDay.map((row) => (
              <div
                key={row.date}
                className="flex items-center justify-between p-3 text-sm"
              >
                <span className="muted">{formatDate(row.date)}</span>
                <span className="font-medium">{row.count} check-ins</span>
              </div>
            ))}
          </PanelList>
        ) : (
          <EmptyNote>No check-in data available.</EmptyNote>
        )}
      </Section>

      <Section title="Top Trainers by Attended Classes">
        {topTrainers && topTrainers.length > 0 ? (
          <PanelList>
            {topTrainers.map((trainer) => (
              <div key={trainer.trainerId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{trainer.trainerName}</div>
                    <div className="muted text-xs">{trainer.classCount} classes taught</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{trainer.attendedCount}</div>
                    <div className="muted text-xs">attendees</div>
                  </div>
                </div>
              </div>
            ))}
          </PanelList>
        ) : (
          <EmptyNote>No trainer data available.</EmptyNote>
        )}
      </Section>

      <Section title="No-shows (Last 14 Days)">
        {noShowList && noShowList.length > 0 ? (
          <PanelList>
            {noShowList.map((item) => (
              <div key={item.bookingId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{item.memberName}</div>
                    <div className="muted text-xs">{item.memberEmail}</div>
                    <div className="muted text-xs mt-1">{item.className}</div>
                    <div className="muted text-xs">{formatDateTime(item.classDate)}</div>
                  </div>
                </div>
              </div>
            ))}
          </PanelList>
        ) : (
          <EmptyNote>No no-shows in the last 14 days.</EmptyNote>
        )}
      </Section>
    </div>
  );
}
