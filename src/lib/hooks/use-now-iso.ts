"use client";

import { useState } from "react";

/**
 * "Now", fixed for as long as the component stays mounted.
 *
 * Calling `new Date().toISOString()` straight inside a `useQuery` input looks
 * harmless but spins: the timestamp differs on every render, so React Query
 * sees a brand-new query key each time, fetches, re-renders with the result,
 * builds another new key, and fetches again — for ever. The schedule page and
 * the reschedule picker both did this, hammering `classes.list` continuously.
 *
 * Freezing the value at mount is enough. These screens are asking "what is on
 * from now onwards", and a page open long enough for the answer to drift is
 * already being refreshed by React Query's own invalidation.
 */
export function useNowIso(): string {
  const [now] = useState(() => new Date().toISOString());
  return now;
}
