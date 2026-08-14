"use client";

import { useState } from "react";
import { EmptyNote, InlineAlert, LoadingMessage, PageHeader, Section } from "@/components/ui";
import { BookingRow } from "@/features/bookings/ui/booking-row";
import { MembershipSummary } from "@/features/members/ui/membership-summary";
import { RescheduleHistory } from "@/features/reschedules/ui/reschedule-history";
import {
  RescheduleModal,
  type RescheduleTarget,
} from "@/features/reschedules/ui/reschedule-modal";
import { useTransientValue } from "@/lib/hooks/use-transient";
import { trpc } from "@/lib/trpc/client";

export default function DashboardPage() {
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null);
  const [successMessage, showSuccessMessage] = useTransientValue<string>();

  const utils = trpc.useUtils();

  const { data: profile, isLoading } = trpc.members.profile.useQuery(undefined, {
    retry: false,
  });
  const { data: bookings } = trpc.bookings.mine.useQuery({ includePast: false });
  const { data: rescheduleHistory } = trpc.reschedules.history.useQuery();

  const cancel = trpc.bookings.cancel.useMutation({
    onSuccess: async () => {
      await utils.bookings.mine.invalidate();
      await utils.members.profile.invalidate();
      await utils.classes.list.invalidate();
    },
  });

  if (isLoading) return <LoadingMessage />;
  if (!profile) return <p className="muted">Please sign in to view your bookings.</p>;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Hello, ${profile.name.split(" ")[0]}`}
        subtitle={`${profile.classesAttended} classes attended`}
      />

      <MembershipSummary membership={profile.membership} />

      <Section title="Upcoming bookings">
        {successMessage && <InlineAlert tone="success">{successMessage}</InlineAlert>}
        {cancel.error && <InlineAlert tone="error">{cancel.error.message}</InlineAlert>}

        {bookings?.length ? (
          <div className="space-y-2">
            {bookings.map((booking) => (
              <BookingRow
                key={booking.id}
                booking={booking}
                busy={cancel.isPending}
                onReschedule={() =>
                  setRescheduleTarget({
                    bookingId: booking.id,
                    classId: booking.classId,
                    className: booking.className,
                    classTime: booking.startsAt,
                  })
                }
                onCancel={() => cancel.mutate({ bookingId: booking.id })}
              />
            ))}
          </div>
        ) : (
          <EmptyNote>No upcoming bookings.</EmptyNote>
        )}
      </Section>

      <RescheduleHistory records={rescheduleHistory ?? []} />

      <RescheduleModal
        target={rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        onSuccess={() => showSuccessMessage("Class rescheduled successfully!")}
      />
    </div>
  );
}
