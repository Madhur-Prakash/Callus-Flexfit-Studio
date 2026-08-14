"use client";

import Link from "next/link";
import { LoadingMessage, PageHeaderRow, PanelList, Section, StatTile } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc/client";

/** Where the utilisation figure starts being worth highlighting. */
const BUSY_THRESHOLD = 0.8;

const ADMIN_LINKS = [
  { href: "/admin/companies", label: "Corporate Memberships" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/announcements", label: "Send announcement" },
];

export function AdminOverviewScreen() {
  const {
    data: stats,
    isLoading,
    error,
  } = trpc.admin.stats.useQuery(undefined, { retry: false });

  const { data: utilisation } = trpc.admin.classUtilisation.useQuery({ limit: 8 });
  const { data: payments } = trpc.payments.all.useQuery({ limit: 10 });

  if (isLoading) return <LoadingMessage />;
  if (error) return <p className="muted">{error.message}</p>;

  const tiles: Array<[string, string]> = [
    ["Members", String(stats!.totalMembers)],
    ["Active memberships", String(stats!.activeMemberships)],
    ["Upcoming classes", String(stats!.upcomingClasses)],
    ["Revenue", formatMoney(stats!.revenueCents)],
    ["Check-ins", String(stats!.totalCheckins)],
    ["Pending payments", String(stats!.pendingPayments)],
  ];

  return (
    <div className="space-y-8">
      <PageHeaderRow title="Admin">
        <div className="flex gap-2">
          {ADMIN_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="btn btn-sm">
              {link.label}
            </Link>
          ))}
        </div>
      </PageHeaderRow>

      <section className="grid gap-3 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <StatTile key={label} label={label} value={value} />
        ))}
      </section>

      <Section title="Class utilisation">
        <PanelList>
          {utilisation?.map((cls) => (
            <div key={cls.id} className="flex items-center gap-4 p-3 text-sm">
              <span className="flex-1">{cls.name}</span>
              <span className="muted">{formatDateTime(cls.startsAt)}</span>
              <span className="muted">
                {cls.booked}/{cls.capacity}
              </span>
              <span
                style={{
                  color: cls.utilisation > BUSY_THRESHOLD ? "var(--accent)" : undefined,
                }}
              >
                {Math.round(cls.utilisation * 100)}%
              </span>
            </div>
          ))}
        </PanelList>
      </Section>

      <Section title="Recent payments">
        <PanelList>
          {payments?.map((payment) => (
            <div key={payment.id} className="flex items-center gap-4 p-3 text-sm">
              <span className="flex-1">{payment.memberName}</span>
              <span className="muted">{payment.method}</span>
              <span className="muted">{payment.status}</span>
              <span>{formatMoney(payment.amountCents)}</span>
            </div>
          ))}
        </PanelList>
      </Section>
    </div>
  );
}
