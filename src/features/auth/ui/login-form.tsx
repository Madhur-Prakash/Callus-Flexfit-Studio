"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { color } from "@/components/ui";
import { trpc } from "@/lib/trpc/client";

export function LoginForm() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      router.push("/dashboard");
    },
  });

  return (
    <form
      className="panel space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        login.mutate({ email, password });
      }}
    >
      <div className="space-y-1.5">
        <label className="text-sm muted">Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm muted">Password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {login.error && (
        <p className="text-sm" style={{ color: color.danger }}>
          {login.error.message}
        </p>
      )}

      <button className="btn btn-primary w-full" type="submit" disabled={login.isPending}>
        {login.isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
