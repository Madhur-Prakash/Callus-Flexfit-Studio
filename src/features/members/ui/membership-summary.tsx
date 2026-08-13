"use client";

import type { ReactNode } from "react";
import { UNLIMITED_CREDITS } from "@/features/memberships/credits";
import { formatDate } from "@/lib/format";

type Membership = {
  planName: string;
  status: string;
  endDate: string;
  creditsRemaining: number;
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The member's current plan at a glance. */
export function MembershipSummary({ membership }: { membership: Membership | null }) {
  return (
    <section className="panel p-5">
      <h2 className="font-medium">Membership</h2>
      {membership ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <Detail label="Plan">{membership.planName}</Detail>
          <Detail label="Status">{membership.status}</Detail>
          <Detail label="Valid until">{formatDate(membership.endDate)}</Detail>
          <Detail label="Credits">
            {membership.creditsRemaining >= UNLIMITED_CREDITS
              ? "Unlimited"
              : membership.creditsRemaining}
          </Detail>
        </dl>
      ) : (
        <p className="muted mt-2 text-sm">
          No active membership. Pick a plan to start booking classes.
        </p>
      )}
    </section>
  );
}
