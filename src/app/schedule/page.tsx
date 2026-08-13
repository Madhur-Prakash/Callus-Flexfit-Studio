"use client";

import { InlineAlert, LoadingMessage, PageHeader } from "@/components/ui";
import { ClassRow } from "@/features/classes/ui/class-row";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useNowIso } from "@/lib/hooks/use-now-iso";
import { trpc } from "@/lib/trpc/client";

export default function SchedulePage() {
  const utils = trpc.useUtils();
  const { user } = useCurrentUser();
  const { data: classes, isLoading } = trpc.classes.list.useQuery({
    from: useNowIso(),
  });

  const book = trpc.bookings.book.useMutation({
    onSuccess: async () => {
      await utils.classes.list.invalidate();
      await utils.bookings.mine.invalidate();
    },
  });

  if (isLoading) return <LoadingMessage>Loading schedule...</LoadingMessage>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class schedule"
        subtitle={`${classes?.length ?? 0} upcoming classes`}
      />

      {book.error && <InlineAlert tone="error">{book.error.message}</InlineAlert>}

      <div className="space-y-2">
        {classes?.map((cls) => (
          <ClassRow
            key={cls.id}
            cls={cls}
            disabled={!user || book.isPending}
            onBook={() => book.mutate({ classId: cls.id })}
          />
        ))}
      </div>

      {!user && <p className="muted text-sm">Sign in to book a class.</p>}
    </div>
  );
}
