"use client";

import { useEffect } from "react";
import { InlineAlert, PageHeader } from "@/components/ui";

/**
 * Catches anything a route throws while rendering, so one broken screen shows a
 * recoverable message instead of blanking the whole app.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Nowhere to send this yet; the console is what the studio has.
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Something went wrong"
        subtitle="The page failed to load. Trying again often works."
      />

      <InlineAlert tone="error">{error.message || "Unknown error."}</InlineAlert>

      <button className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
