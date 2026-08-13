import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { expect } from "vitest";
import { appRouter, hashPassword, schema } from "./app";
import { DDL_FILE } from "./global-setup";

export { schema };

export type TestDb = ReturnType<typeof createTestDb>;
export type Role = "member" | "trainer" | "admin";

/** A fresh, empty, in-memory studio. */
export function createTestDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });

  const ddl = readFileSync(DDL_FILE, "utf8");
  for (const statement of ddl.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) client.executeMultiple(trimmed);
  }

  return db;
}

/** Calls procedures as `user`, or anonymously when `user` is null. */
export function callerFor(db: TestDb, user: schema.User | null) {
  return appRouter.createCaller({ db, user, token: user ? "test-token" : undefined });
}

// --- fixtures -------------------------------------------------------------

let seq = 0;

export async function makeUser(
  db: TestDb,
  overrides: Partial<schema.User> = {},
): Promise<schema.User> {
  seq += 1;
  return db
    .insert(schema.users)
    .values({
      email: overrides.email ?? `user${seq}@example.test`,
      passwordHash: overrides.passwordHash ?? hashPassword("secret123"),
      name: overrides.name ?? `User ${seq}`,
      phone: overrides.phone ?? `+91 90000 ${String(10000 + seq)}`,
      role: overrides.role ?? "member",
      active: overrides.active ?? true,
    })
    .returning()
    .get();
}

export async function makePlan(
  db: TestDb,
  overrides: Partial<schema.MembershipPlan> = {},
) {
  return db
    .insert(schema.membershipPlans)
    .values({
      name: overrides.name ?? "Test Plan",
      description: overrides.description ?? "A plan.",
      priceCents: overrides.priceCents ?? 100000,
      durationDays: overrides.durationDays ?? 30,
      classCredits: overrides.classCredits ?? 10,
      active: overrides.active ?? true,
    })
    .returning()
    .get();
}

export async function makeMembership(
  db: TestDb,
  userId: number,
  overrides: Partial<schema.Membership> = {},
) {
  const planId = overrides.planId ?? (await makePlan(db)).id;
  return db
    .insert(schema.memberships)
    .values({
      userId,
      planId,
      startDate: overrides.startDate ?? isoDate(-1),
      endDate: overrides.endDate ?? isoDate(30),
      creditsRemaining: overrides.creditsRemaining ?? 10,
      status: overrides.status ?? "active",
    })
    .returning()
    .get();
}

export async function makeClass(
  db: TestDb,
  overrides: Partial<schema.GymClass> = {},
) {
  return db
    .insert(schema.classes)
    .values({
      name: overrides.name ?? "Sunrise Yoga",
      description: overrides.description ?? null,
      trainerId: overrides.trainerId ?? null,
      room: overrides.room ?? "Studio A",
      capacity: overrides.capacity ?? 2,
      startsAt: overrides.startsAt ?? hoursFromNow(48),
      durationMin: overrides.durationMin ?? 60,
      creditCost: overrides.creditCost ?? 1,
      cancelled: overrides.cancelled ?? false,
    })
    .returning()
    .get();
}

export async function makeCompany(
  db: TestDb,
  overrides: Partial<schema.Company> = {},
) {
  return db
    .insert(schema.companies)
    .values({
      name: overrides.name ?? "TestCorp",
      contactEmail: overrides.contactEmail ?? "hr@testcorp.test",
      creditPoolBalance: overrides.creditPoolBalance ?? 50,
      active: overrides.active ?? true,
    })
    .returning()
    .get();
}

export async function linkToCompany(db: TestDb, userId: number, companyId: number) {
  return db
    .insert(schema.companyMembers)
    .values({ userId, companyId })
    .returning()
    .get();
}

// --- time helpers ---------------------------------------------------------

export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

export function isoDate(daysFromToday: number): string {
  return new Date(Date.now() + daysFromToday * 86_400_000).toISOString().slice(0, 10);
}

// --- assertions -----------------------------------------------------------

/**
 * Asserts a procedure rejects with an exact tRPC code and message. Error codes
 * and copy are part of the app's contract, so they are pinned, not paraphrased.
 */
export async function expectTrpcError(
  promise: Promise<unknown>,
  code: TRPCError["code"],
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}
