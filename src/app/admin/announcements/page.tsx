"use client";

import { useState } from "react";
import { Field, PageTitle, TextArea, TextInput, TintedBanner } from "@/components/ui";
import { useTransientFlag } from "@/lib/hooks/use-transient";
import { trpc } from "@/lib/trpc/client";

export default function AnnouncementsPage() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sent, markSent] = useTransientFlag();

  const broadcast = trpc.notifications.broadcast.useMutation({
    onSuccess: () => {
      setTitle("");
      setMessage("");
      markSent();
    },
  });

  const canSubmit = title.trim() !== "" && message.trim() !== "";

  return (
    <div className="space-y-6">
      <PageTitle>Broadcast Announcement</PageTitle>

      <div className="panel p-6 max-w-2xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) broadcast.mutate({ title, message });
          }}
        >
          <Field label="Title">
            <TextInput
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Announcement title"
              disabled={broadcast.isPending}
            />
          </Field>

          <Field label="Message">
            <TextArea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Announcement message"
              rows={6}
              disabled={broadcast.isPending}
            />
          </Field>

          <button
            type="submit"
            className="btn"
            disabled={broadcast.isPending || !canSubmit}
          >
            {broadcast.isPending ? "Sending..." : "Send to all members"}
          </button>
        </form>

        {sent && (
          <TintedBanner tone="success" className="mt-4">
            Announcement sent to {broadcast.data?.count || 0} members!
          </TintedBanner>
        )}

        {broadcast.error && (
          <TintedBanner tone="error" className="mt-4">
            {broadcast.error.message}
          </TintedBanner>
        )}
      </div>
    </div>
  );
}
