"use client";

import { useState } from "react";
import {
  AccessDenied,
  Callout,
  PageHeader,
  PanelList,
  Section,
  SubtleButton,
  SubtleInput,
  color,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useTransientValue } from "@/lib/hooks/use-transient";
import { isStaff } from "@/lib/roles";
import { trpc } from "@/lib/trpc/client";

/** How far ahead the desk looks for a member's next class. */
const CHECKIN_WINDOW_HOURS = 2;

/** Lookup needs more than this many characters before it fires. */
const MIN_QUERY_LENGTH = 2;

type SelectedMember = { id: number; name: string };

export default function KioskPage() {
  const { user } = useCurrentUser();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<SelectedMember | null>(null);

  const clearSelection = () => {
    setSearchQuery("");
    setSelectedMember(null);
  };

  const [checkinSuccess, showCheckinSuccess] = useTransientValue<{
    memberName: string;
    className: string;
  }>(3000, clearSelection);

  const lookupMember = trpc.members.lookupByEmailOrPhone.useQuery(
    { query: searchQuery },
    { enabled: !!searchQuery && searchQuery.length > MIN_QUERY_LENGTH },
  );

  const upcomingClasses = trpc.bookings.upcomingForMember.useQuery(
    { userId: selectedMember?.id ?? 0, hoursAhead: CHECKIN_WINDOW_HOURS },
    { enabled: !!selectedMember },
  );

  const memberDetails = trpc.members.byId.useQuery(
    { id: selectedMember?.id ?? 0 },
    { enabled: !!selectedMember },
  );

  const markAttended = trpc.bookings.markAttended.useMutation({
    onSuccess: (_, variables) => {
      const classInfo = upcomingClasses.data?.find(
        (c) => c.bookingId === variables.bookingId,
      );
      if (classInfo && selectedMember) {
        showCheckinSuccess({
          memberName: selectedMember.name,
          className: classInfo.className,
        });
        upcomingClasses.refetch();
      }
    },
  });

  if (!isStaff(user?.role)) {
    return <AccessDenied audience="Staff only." />;
  }

  // The most recent membership is the one the desk cares about.
  const latestMembership = memberDetails.data?.memberships?.[0];
  const isMembershipExpired = latestMembership
    ? new Date(latestMembership.endDate) < new Date()
    : false;
  const hasNoCredits = latestMembership?.creditsRemaining === 0;
  const blockCheckin = isMembershipExpired || hasNoCredits;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Check-in Kiosk"
        subtitle="Look up a member and check them in to upcoming classes"
      />

      {checkinSuccess && (
        <Callout tone="success" className="rounded border p-4">
          <div className="font-medium">✓ Check-in successful</div>
          <div className="muted mt-1 text-sm">
            {checkinSuccess.memberName} checked in to {checkinSuccess.className}
          </div>
        </Callout>
      )}

      <Section title="Find Member">
        <div className="flex gap-2">
          <SubtleInput
            type="text"
            placeholder="Email or phone number"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 rounded border px-3 py-2 text-sm"
          />
        </div>

        {lookupMember.isLoading && <p className="muted text-sm">Searching...</p>}
        {lookupMember.error && (
          <p className="text-sm" style={{ color: color.dangerStrong }}>
            Member not found
          </p>
        )}
        {lookupMember.data && !selectedMember && (
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{lookupMember.data.name}</div>
                <div className="muted text-xs mt-1">{lookupMember.data.email}</div>
                {lookupMember.data.phone && (
                  <div className="muted text-xs">{lookupMember.data.phone}</div>
                )}
              </div>
              <button
                onClick={() => setSelectedMember(lookupMember.data)}
                className="btn btn-primary btn-sm"
              >
                Select
              </button>
            </div>
          </div>
        )}
      </Section>

      {selectedMember && (
        <Section>
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Member: {selectedMember.name}</h2>
            <SubtleButton onClick={clearSelection}>Change member</SubtleButton>
          </div>

          {latestMembership && (
            <div className="space-y-2">
              {isMembershipExpired && (
                <Callout tone="error">⚠ Membership has expired</Callout>
              )}
              {hasNoCredits && <Callout tone="error">⚠ No credits remaining</Callout>}
            </div>
          )}

          {upcomingClasses.isLoading && <p className="muted text-sm">Loading classes...</p>}
          {upcomingClasses.data?.length === 0 && (
            <p className="muted text-sm">
              No classes in the next {CHECKIN_WINDOW_HOURS} hours
            </p>
          )}
          {upcomingClasses.data && upcomingClasses.data.length > 0 && (
            <PanelList>
              {upcomingClasses.data.map((cls) => (
                <div key={cls.bookingId} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{cls.className}</div>
                      <div className="muted mt-1 text-sm">
                        {formatDateTime(cls.startsAt)} · {cls.room} · {cls.durationMin} min
                      </div>
                      {cls.trainerName && (
                        <div className="muted text-xs mt-1">Trainer: {cls.trainerName}</div>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        markAttended.mutate({ bookingId: cls.bookingId, source: "kiosk" })
                      }
                      disabled={markAttended.isPending || blockCheckin}
                      className="btn btn-primary btn-sm ml-4"
                    >
                      Check in
                    </button>
                  </div>
                </div>
              ))}
            </PanelList>
          )}
        </Section>
      )}
    </div>
  );
}
