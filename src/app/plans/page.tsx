"use client";

import { InlineAlert, LoadingMessage, PageTitle } from "@/components/ui";
import { UNLIMITED_CREDITS } from "@/features/memberships/credits";
import { formatMoney } from "@/lib/format";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { trpc } from "@/lib/trpc/client";

export default function PlansPage() {
  const utils = trpc.useUtils();
  const { user } = useCurrentUser();
  const { data: plans, isLoading } = trpc.plans.list.useQuery({});

  const subscribe = trpc.plans.subscribe.useMutation({
    onSuccess: async () => {
      await utils.members.profile.invalidate();
      await utils.payments.mine.invalidate();
    },
  });

  if (isLoading) return <LoadingMessage>Loading plans...</LoadingMessage>;

  return (
    <div className="space-y-6">
      <PageTitle>Membership plans</PageTitle>

      {subscribe.error && (
        <InlineAlert tone="error">{subscribe.error.message}</InlineAlert>
      )}

      {subscribe.isSuccess && (
        <InlineAlert tone="success">Membership activated.</InlineAlert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {plans?.map((plan) => (
          <div key={plan.id} className="panel flex flex-col gap-3 p-5">
            <div>
              <h2 className="font-medium">{plan.name}</h2>
              <p className="muted mt-1 text-sm">{plan.description}</p>
            </div>

            <div className="text-2xl font-semibold">{formatMoney(plan.priceCents)}</div>

            <p className="muted text-sm">
              {plan.durationDays} days &middot;{" "}
              {plan.classCredits >= UNLIMITED_CREDITS
                ? "Unlimited classes"
                : `${plan.classCredits} credits`}
            </p>

            <button
              className="btn btn-primary mt-auto"
              disabled={!user || subscribe.isPending}
              onClick={() => subscribe.mutate({ planId: plan.id, method: "card" })}
            >
              {user ? "Subscribe" : "Sign in to subscribe"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
