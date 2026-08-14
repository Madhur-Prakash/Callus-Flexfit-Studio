"use client";

import { useState } from "react";
import { Field, TextInput, borderStyle } from "@/components/ui";
import { trpc } from "@/lib/trpc/client";

/** Search fires once the query is longer than this. */
const MIN_QUERY_LENGTH = 2;

/** Finds members to attach to a company, hiding those already linked. */
export function MemberPicker({
  linkedMemberIds,
  pending,
  onDone,
  onPick,
}: {
  linkedMemberIds: number[];
  pending: boolean;
  onDone: () => void;
  onPick: (userId: number) => void;
}) {
  const [query, setQuery] = useState("");

  const { data: results } = trpc.members.search.useQuery(
    { q: query },
    { enabled: query.length > MIN_QUERY_LENGTH },
  );

  // Staff are excluded here rather than left to fail on submit: the server
  // refuses to link anyone who is not a member, so offering trainers and
  // admins in this list only produces an error the admin cannot act on.
  const linked = new Set(linkedMemberIds);
  const candidates = (results ?? []).filter(
    (user) => user.role === "member" && !linked.has(user.id),
  );

  return (
    <div className="panel p-4 space-y-3">
      <Field label="Search Members">
        <TextInput
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email (3+ chars)"
          disabled={pending}
        />
      </Field>

      {results && results.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {candidates.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-2 border rounded"
              style={borderStyle}
            >
              <div className="flex-1">
                <div className="font-medium text-sm">{user.name}</div>
                <div className="text-xs muted">{user.email}</div>
              </div>
              <button
                onClick={() => onPick(user.id)}
                className="btn btn-sm"
                disabled={pending}
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn-outline"
        onClick={() => {
          setQuery("");
          onDone();
        }}
        disabled={pending}
      >
        Done
      </button>
    </div>
  );
}
