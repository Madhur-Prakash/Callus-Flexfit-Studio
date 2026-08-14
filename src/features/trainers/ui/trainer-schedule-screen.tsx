"use client";

import {
  EmptyNote,
  LoadingMessage,
  PageHeader,
  PanelList,
  Section,
} from "@/components/ui";
import { useRoleGuard } from "@/components/auth/use-role-guard";
import { AvailabilityEditor } from "@/features/trainers/ui/availability-editor";
import { TrainerClassCard } from "@/features/trainers/ui/trainer-class-card";
import { trpc } from "@/lib/trpc/client";

export function TrainerScheduleScreen() {
  const { allowed, denied } = useRoleGuard("trainer");

  const { data: classes, isLoading: classesLoading } =
    trpc.trainers.upcomingClasses.useQuery(undefined, { enabled: allowed });

  const { data: availability, isLoading: availabilityLoading } =
    trpc.trainers.availability.useQuery(undefined, { enabled: allowed });

  if (denied) return denied;

  if (classesLoading || availabilityLoading) return <LoadingMessage />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Trainer Schedule"
        subtitle="Manage your availability and upcoming classes"
      />

      <Section title="Upcoming Classes">
        {classes && classes.length > 0 ? (
          <PanelList>
            {classes.map((cls) => (
              <TrainerClassCard key={cls.id} cls={cls} />
            ))}
          </PanelList>
        ) : (
          <EmptyNote>No upcoming classes.</EmptyNote>
        )}
      </Section>

      <Section title="Weekly Availability">
        <AvailabilityEditor availability={availability ?? []} />
      </Section>
    </div>
  );
}
