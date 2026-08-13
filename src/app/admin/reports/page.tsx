"use client";

import {
  EmptyNote,
  LoadingMessage,
  PageHeader,
  PanelList,
  Section,
  StatTile,
} from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc/client";

export default function AdminReportsPage() {
  const { data: revenueByMonth, isLoading: monthLoading } =
    trpc.admin.revenueByMonth.useQuery();
  const { data: revenueByMethod, isLoading: methodLoading } =
    trpc.admin.revenueByMethod.useQuery();
  const { data: expiringMembers, isLoading: expiringLoading } =
    trpc.admin.expiringMemberships.useQuery();
  const { data: refundData, isLoading: refundLoading } = trpc.admin.refundCount.useQuery();

  if (monthLoading || methodLoading || expiringLoading || refundLoading) {
    return <LoadingMessage>Loading reports...</LoadingMessage>;
  }

  const totalRevenue = (revenueByMonth ?? []).reduce(
    (sum, row) => sum + row.totalCents,
    0,
  );

  return (
    <div className="space-y-8">
      <PageHeader title="Reports" subtitle="Payment analytics and member insights" />

      <section className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Total Revenue" value={formatMoney(totalRevenue)} />
        <StatTile label="Refunds Issued" value={refundData?.count ?? 0} />
        <StatTile label="Payment Methods" value={revenueByMethod?.length ?? 0} />
        <StatTile label="Expiring Soon" value={expiringMembers?.length ?? 0} />
      </section>

      <Section title="Revenue by Month">
        {revenueByMonth && revenueByMonth.length > 0 ? (
          <PanelList>
            {revenueByMonth.map((row) => (
              <div
                key={row.month}
                className="flex items-center justify-between p-3 text-sm"
              >
                <span className="muted">{row.month}</span>
                <span className="font-medium">{formatMoney(row.totalCents)}</span>
              </div>
            ))}
          </PanelList>
        ) : (
          <EmptyNote>No revenue data available.</EmptyNote>
        )}
      </Section>

      <Section title="Revenue by Payment Method">
        {revenueByMethod && revenueByMethod.length > 0 ? (
          <PanelList>
            {revenueByMethod.map((row) => (
              <div
                key={row.method}
                className="flex items-center justify-between p-3 text-sm"
              >
                <div className="flex-1">
                  <div className="capitalize">{row.method}</div>
                  <div className="muted text-xs">{row.count} transactions</div>
                </div>
                <span className="font-medium">{formatMoney(row.totalCents)}</span>
              </div>
            ))}
          </PanelList>
        ) : (
          <EmptyNote>No payment method data available.</EmptyNote>
        )}
      </Section>

      <Section title="Memberships Expiring in 14 Days">
        {expiringMembers && expiringMembers.length > 0 ? (
          <PanelList>
            {expiringMembers.map((member) => (
              <div key={member.memberId} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{member.memberName}</div>
                    <div className="muted text-xs">{member.memberEmail}</div>
                  </div>
                  <div className="text-right">
                    <div className="muted text-xs">{member.planName}</div>
                    <div className="text-xs">{formatDate(member.expiresAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </PanelList>
        ) : (
          <EmptyNote>No memberships expiring in the next 14 days.</EmptyNote>
        )}
      </Section>
    </div>
  );
}
