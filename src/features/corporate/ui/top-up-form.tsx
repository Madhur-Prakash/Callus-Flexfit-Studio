"use client";

import { useState } from "react";
import { Field, TextInput } from "@/components/ui";

/** Adds credits to a company's shared pool. */
export function TopUpForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (amount: number) => void;
}) {
  const [amount, setAmount] = useState("");

  return (
    <div className="panel p-4">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseInt(amount);
          if (parsed > 0) onSubmit(parsed);
        }}
      >
        <Field label="Top Up Amount">
          <TextInput
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Number of credits"
            disabled={pending}
            min="1"
          />
        </Field>
        <div className="flex gap-2">
          <button type="submit" className="btn" disabled={pending || !amount}>
            {pending ? "Processing..." : "Top Up"}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
