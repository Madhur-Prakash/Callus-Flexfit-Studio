"use client";

import {
  AccessDenied,
  EmptyNote,
  LoadingMessage,
  PageHeader,
  PanelList,
  Section,
} from "@/components/ui";
import { AvailabilityEditor } from "@/features/trainers/ui/availability-editor";
import { TrainerClassCard } from "@/features/trainers/ui/trainer-class-card";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { isTrainer } from "@/lib/roles";
import { trpc } from "@/lib/trpc/client";

export default function TrainerSchedulePage() {
  const { user } = useCurrentUser();

  const { data: classes, isLoading: classesLoading } =
    trpc.trainers.upcomingClasses.useQuery(undefined, {
      enabled: isTrainer(user?.role),
    });

  const { data: availability, isLoading: availabilityLoading } =
    trpc.trainers.availability.useQuery(undefined, {
      enabled: isTrainer(user?.role),
    });

  if (!isTrainer(user?.role)) {
    return <AccessDenied audience="Trainers only." />;
  }

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
