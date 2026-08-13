import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { afterEach, expect } from "vitest";
import { appRouter, hashPassword, schema } from "./app";
import { DB_DIR, DDL_FILE } from "./global-setup";

export { schema };

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
export type Role = "member" | "trainer" | "admin";

const openClients: Array<ReturnType<typeof createClient>> = [];

// Freeing the file handles so the temp directory can be removed afterwards.
afterEach(() => {
  while (openClients.length) openClients.pop()?.close();
});

/**
 * A fresh, empty studio in its own throwaway database file.
 *
 * Deliberately a file rather than `:memory:`. Under @libsql/client a local
 * in-memory database does not survive `db.transaction()` — the tables are gone
 * once the transaction commits — and the booking mutations are transactional.
 * A file also matches how the app actually runs.
 */
export async function createTestDb() {
  // randomUUID, not a counter: test files run in parallel worker threads that
  // share a pid, so anything derived from the process would collide and two
  // workers would fight over the same file.
  const file = join(DB_DIR, `test-${randomUUID()}.db`);

  const client = createClient({ url: `file:${file}` });
  openClients.push(client);

  const db = drizzle(client, { schema });

  // One call, awaited. The statements are already `;`-terminated, so the
  // breakpoint markers just come out.
  const ddl = readFileSync(DDL_FILE, "utf8");
  await client.executeMultiple(ddl.replaceAll("--> statement-breakpoint", ""));

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
