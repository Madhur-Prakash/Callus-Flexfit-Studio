"use client";

import { useState } from "react";
import { Field, TextInput, TintedBanner } from "@/components/ui";

type NewCompany = {
  name: string;
  contactEmail: string;
  creditPoolBalance: number;
};

/** The "new corporate account" form on the companies list. */
export function CompanyForm({
  pending,
  /** Server-side failure from the create mutation, if the last attempt failed. */
  errorMessage,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onSubmit: (company: NewCompany) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState("0");
  const [validationError, setValidationError] = useState("");

  const canSubmit = name.trim() !== "" && email.trim() !== "";
  const error = validationError || errorMessage;

  return (
    <div className="panel p-6 max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Create New Company</h2>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setValidationError("");
          if (!canSubmit) {
            setValidationError("Name and email are required");
            return;
          }
          onSubmit({
            name: name.trim(),
            contactEmail: email.trim(),
            creditPoolBalance: parseInt(credits) || 0,
          });
        }}
      >
        <Field label="Company Name">
          <TextInput
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. TechCorp Inc"
            disabled={pending}
          />
        </Field>

        <Field label="Contact Email">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@techcorp.com"
            disabled={pending}
          />
        </Field>

        <Field label="Initial Credit Pool">
          <TextInput
            type="number"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            placeholder="0"
            disabled={pending}
            min="0"
          />
        </Field>

        <div className="flex gap-2">
          <button type="submit" className="btn" disabled={pending || !canSubmit}>
            {pending ? "Creating..." : "Create Company"}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              setValidationError("");
              onCancel();
            }}
            disabled={pending}
          >
            Cancel
          </button>
        </div>

        {error && <TintedBanner tone="error">{error}</TintedBanner>}
      </form>
    </div>
  );
}
