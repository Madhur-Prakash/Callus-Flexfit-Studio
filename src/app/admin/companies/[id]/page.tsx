"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import {
  EmptyPanel,
  LoadingMessage,
  PageTitle,
  PanelList,
  Section,
} from "@/components/ui";
import { MemberPicker } from "@/features/corporate/ui/member-picker";
import { TopUpForm } from "@/features/corporate/ui/top-up-form";
import { formatDateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc/client";

export default function CompanyDetailsPage() {
  const params = useParams();
  const id = parseInt(params.id as string);

  const { data: company, isLoading, refetch } = trpc.adminCompanies.getById.useQuery({ id });

  const [showTopUpForm, setShowTopUpForm] = useState(false);
  const [showMemberForm, setShowMemberForm] = useState(false);

  const reload = () => {
    refetch();
  };

  const topUpMutation = trpc.adminCompanies.topUp.useMutation({
    onSuccess: () => {
      setShowTopUpForm(false);
      reload();
    },
  });

  const activeMutation = trpc.adminCompanies.updateActive.useMutation({
    onSuccess: reload,
  });

  const linkMutation = trpc.adminCompanies.linkMember.useMutation({
    onSuccess: () => {
      setShowMemberForm(false);
      reload();
    },
  });

  const unlinkMutation = trpc.adminCompanies.unlinkMember.useMutation({
    onSuccess: reload,
  });

  if (isLoading) return <LoadingMessage />;
  if (!company) return <p className="muted">Company not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <PageTitle>{company.name}</PageTitle>
          <p className="muted text-sm">{company.contactEmail}</p>
        </div>
        <button
          onClick={() => activeMutation.mutate({ id, active: !company.active })}
          className={company.active ? "btn btn-danger btn-sm" : "btn btn-sm"}
          disabled={activeMutation.isPending}
        >
          {company.active ? "Deactivate" : "Activate"}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CompanyMetric
          label="Credit Pool Balance"
          value={company.creditPoolBalance}
          action="Top Up"
          onAction={() => setShowTopUpForm(!showTopUpForm)}
        />
        <CompanyMetric
          label="Linked Members"
          value={company.members.length}
          action="Add Member"
          onAction={() => setShowMemberForm(!showMemberForm)}
        />
      </div>

      {showTopUpForm && (
        <TopUpForm
          pending={topUpMutation.isPending}
          onCancel={() => setShowTopUpForm(false)}
          onSubmit={(amount) => topUpMutation.mutate({ id, amount })}
        />
      )}

      {showMemberForm && (
        <MemberPicker
          linkedMemberIds={company.members.map((m) => m.id)}
          pending={linkMutation.isPending}
          onDone={() => setShowMemberForm(false)}
          onPick={(userId) => linkMutation.mutate({ companyId: id, userId })}
        />
      )}

      <Section title={`Linked Members (${company.members.length})`}>
        {company.members.length > 0 ? (
          <PanelList>
            {company.members.map((member) => (
              <div key={member.id} className="flex items-center gap-4 p-3">
                <div className="flex-1">
                  <div className="font-medium text-sm">{member.name}</div>
                  <div className="text-xs muted">{member.email}</div>
                </div>
                <button
                  onClick={() =>
                    unlinkMutation.mutate({ companyMemberId: member.companyMemberId })
                  }
                  className="btn-outline btn-sm text-red-600"
                  disabled={unlinkMutation.isPending}
                >
                  Remove
                </button>
              </div>
            ))}
          </PanelList>
        ) : (
          <EmptyPanel>No members linked yet</EmptyPanel>
        )}
      </Section>

      <Section title="Recent Corporate Bookings">
        {company.recentBookings.length > 0 ? (
          <PanelList>
            {company.recentBookings.map((booking) => (
              <div key={booking.id} className="p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{booking.className}</span>
                  <span
                    className={booking.status === "attended" ? "text-green-600" : undefined}
                  >
                    {booking.status}
                  </span>
                </div>
                <div className="muted">
                  {booking.memberName} · {formatDateTime(booking.startsAt)}
                </div>
                <div className="muted">Credits used: {booking.creditsUsed}</div>
              </div>
            ))}
          </PanelList>
        ) : (
          <EmptyPanel>No bookings yet</EmptyPanel>
        )}
      </Section>
    </div>
  );
}

/** A headline number with the control that changes it. */
function CompanyMetric({
  label,
  value,
  action,
  onAction,
}: {
  label: string;
  value: number;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="panel p-4">
      <div className="muted text-xs uppercase tracking-wide mb-2">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <button onClick={onAction} className="btn btn-sm mt-3">
        {action}
      </button>
    </div>
  );
}
