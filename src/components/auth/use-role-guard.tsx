"use client";

import { AccessDenied } from "@/components/ui";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { isAdmin, isStaff, isTrainer } from "@/lib/roles";

/**
 * Who a screen is for, and what it says when you are not them.
 *
 * Keeping the predicate and the message together is the point: three screens
 * used to spell out their own pair, so a screen could check one role and name
 * another in the message with nothing to catch it.
 */
const AUDIENCES = {
  admin: { allows: isAdmin, message: "Admins only." },
  trainer: { allows: isTrainer, message: "Trainers only." },
  staff: { allows: isStaff, message: "Staff only." },
} as const;

/**
 * Guards a screen by role.
 *
 * Returns `denied` — the element to render instead of the page — and `allowed`,
 * for gating the queries the screen would otherwise fire before it knows who is
 * asking. This is a convenience, not a security boundary: every procedure
 * re-checks the role on the server.
 */
export function useRoleGuard(audience: keyof typeof AUDIENCES) {
  const { user } = useCurrentUser();
  const { allows, message } = AUDIENCES[audience];
  const allowed = allows(user?.role);

  return {
    allowed,
    denied: allowed ? null : <AccessDenied audience={message} />,
  };
}
