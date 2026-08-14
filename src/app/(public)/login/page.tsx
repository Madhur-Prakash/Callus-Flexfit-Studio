import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { LoginForm } from "@/features/auth/ui/login-form";

export const metadata: Metadata = { title: "Sign in" };

/** The seeded accounts, shown so the studio can be tried out. */
const DEMO_ACCOUNTS = [
  "admin@flexfit.test / admin123",
  "arjun@flexfit.test / trainer123",
  "rahul.k@example.com / member123",
];

export default function Page() {
  return (
    <div className="mx-auto max-w-sm space-y-6">
      <PageTitle>Sign in</PageTitle>

      <LoginForm />

      <div className="panel p-4 text-sm muted">
        <p className="mb-2 font-medium" style={{ color: "var(--text)" }}>
          Demo accounts
        </p>
        {DEMO_ACCOUNTS.map((account) => (
          <p key={account}>{account}</p>
        ))}
      </div>
    </div>
  );
}
