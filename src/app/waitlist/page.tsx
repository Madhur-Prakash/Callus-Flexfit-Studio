"use client";

import { Badge, EmptyNote, InlineAlert, LoadingMessage, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc/client";

export default function WaitlistPage() {
  const utils = trpc.useUtils();
  const { data: waitlisted, isLoading } = trpc.bookings.waitlisted.useQuery();

  const cancel = trpc.bookings.cancel.useMutation({
    onSuccess: async () => {
      await utils.bookings.waitlisted.invalidate();
      await utils.bookings.mine.invalidate();
      await utils.classes.list.invalidate();
    },
  });

  if (isLoading) return <LoadingMessage />;

  return (
    <div className="space-y-6">
      <PageHeader title="Waitlist" subtitle="Classes you're waitlisted for" />

      {cancel.error && <InlineAlert tone="error">{cancel.error.message}</InlineAlert>}

      {waitlisted?.length ? (
        <div className="space-y-2">
          {waitlisted.map((entry) => (
            <div key={entry.bookingId} className="panel flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{entry.className}</h3>
                  <Badge size="md">#{entry.position} in queue</Badge>
                </div>
                <p className="muted mt-0.5 text-sm">
                  {formatDateTime(entry.startsAt)} &middot; {entry.room} &middot;{" "}
                  {entry.durationMin} min
                </p>
              </div>

              <button
                className="btn"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ bookingId: entry.bookingId })}
              >
                Leave waitlist
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyNote>You&apos;re not waitlisted for any classes.</EmptyNote>
      )}
    </div>
  );
}
