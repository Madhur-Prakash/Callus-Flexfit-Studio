"use client";

import { trpc } from "@/lib/trpc/client";

/**
 * The signed-in user, or undefined while loading / null when anonymous.
 *
 * Pages call this to decide what to render. It is not a security boundary —
 * every procedure re-checks the role on the server.
 */
export function useCurrentUser() {
  const { data: user, isLoading } = trpc.auth.me.useQuery();
  return { user, isLoading };
}
