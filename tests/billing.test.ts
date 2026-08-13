import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  callerFor,
  createTestDb,
  expectTrpcError,
  makePlan,
  makeMembership,
  makeUser,
  schema,
  type TestDb,
} from "./support/harness";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

describe("plans.list", () => {
  it("hides inactive plans unless asked", async () => {
    await makePlan(db, { name: "Live" });
    await makePlan(db, { name: "Retired", active: false });

    const caller = callerFor(db, null);
    expect((await caller.plans.list({})).map((p) => p.name)).toEqual(["Live"]);
    expect((await caller.plans.list({ includeInactive: true })).map((p) => p.name)).toEqual([
      "Live",
      "Retired",
    ]);
  });
});

describe("plans.subscribe", () => {
  it("creates a membership dated from today and a matching paid payment", async () => {
    const member = await makeUser(db);
    const plan = await makePlan(db, {
      priceCents: 450000,
      durationDays: 30,
      classCredits: 999,
    });

    const membership = await callerFor(db, member).plans.subscribe({
      planId: plan.id,
      method: "upi",
    });

    const today = new Date().toISOString().slice(0, 10);
    const expectedEnd = (() => {
      const d = new Date(today);
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    })();

    expect(membership).toMatchObject({
      userId: member.id,
      planId: plan.id,
      startDate: today,
      endDate: expectedEnd,
      creditsRemaining: 999,
      status: "active",
    });

    const payment = await db.select().from(schema.payments).get();
    expect(payment).toMatchObject({
      userId: member.id,
      membershipId: membership.id,
      amountCents: 450000,
      method: "upi",
      status: "paid",
    });
    expect(payment!.reference).toMatch(/^PAY-\d+$/);
  });

  it("defaults to card", async () => {
    const member = await makeUser(db);
    const plan = await makePlan(db);
    await callerFor(db, member).plans.subscribe({ planId: plan.id });

    const payment = await db.select().from(schema.payments).get();
    expect(payment!.method).toBe("card");
  });

  it("rejects unknown and retired plans", async () => {
    const member = await makeUser(db);
    const caller = callerFor(db, member);

    await expectTrpcError(caller.plans.subscribe({ planId: 9999 }), "NOT_FOUND", "Plan not found.");

    const retired = await makePlan(db, { active: false });
    await expectTrpcError(
      caller.plans.subscribe({ planId: retired.id }),
      "BAD_REQUEST",
      "This plan is no longer available.",
    );
  });

  it("is admin-only to create plans", async () => {
    const member = await makeUser(db);
    await expectTrpcError(
      callerFor(db, member).plans.create({
        name: "Sneaky",
        priceCents: 1,
        durationDays: 1,
      }),
      "FORBIDDEN",
      "Admins only.",
    );
  });
});

describe("payments.refund", () => {
  it("refunds a paid payment and cancels the membership it paid for", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id);
    const payment = await db
      .insert(schema.payments)
      .values({
        userId: member.id,
        membershipId: membership.id,
        amountCents: 1000,
        method: "card",
        status: "paid",
      })
      .returning()
      .get();

    const admin = await makeUser(db, { role: "admin" });
    const updated = await callerFor(db, admin).payments.refund({ id: payment.id });

    expect(updated.status).toBe("refunded");

    const after = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id))
      .get();
    expect(after!.status).toBe("cancelled");
  });

  it("refuses to refund anything that is not paid", async () => {
    const member = await makeUser(db);
    const payment = await db
      .insert(schema.payments)
      .values({ userId: member.id, amountCents: 1000, method: "cash", status: "pending" })
      .returning()
      .get();

    const admin = await makeUser(db, { role: "admin" });
    await expectTrpcError(
      callerFor(db, admin).payments.refund({ id: payment.id }),
      "BAD_REQUEST",
      "Only paid payments can be refunded.",
    );
  });

  it("refuses to mark a refunded payment paid again", async () => {
    const member = await makeUser(db);
    const payment = await db
      .insert(schema.payments)
      .values({ userId: member.id, amountCents: 1000, method: "cash", status: "refunded" })
      .returning()
      .get();

    const admin = await makeUser(db, { role: "admin" });
    await expectTrpcError(
      callerFor(db, admin).payments.markPaid({ id: payment.id }),
      "BAD_REQUEST",
      "Refunded payments cannot be marked paid.",
    );
  });

  it("marks a pending payment paid", async () => {
    const member = await makeUser(db);
    const payment = await db
      .insert(schema.payments)
      .values({ userId: member.id, amountCents: 1000, method: "cash", status: "pending" })
      .returning()
      .get();

    const admin = await makeUser(db, { role: "admin" });
    const updated = await callerFor(db, admin).payments.markPaid({ id: payment.id });
    expect(updated.status).toBe("paid");
  });

  it("keeps refunds and the payment list admin-only", async () => {
    const member = await makeUser(db);
    await expectTrpcError(
      callerFor(db, member).payments.all({}),
      "FORBIDDEN",
      "Admins only.",
    );

    const trainer = await makeUser(db, { role: "trainer" });
    await expectTrpcError(
      callerFor(db, trainer).payments.refund({ id: 1 }),
      "FORBIDDEN",
      "Admins only.",
    );
  });
});

describe("payments.mine", () => {
  it("returns only the caller's payments, newest first, with the plan name", async () => {
    const member = await makeUser(db);
    const plan = await makePlan(db, { name: "Monthly Unlimited" });
    await callerFor(db, member).plans.subscribe({ planId: plan.id });

    const other = await makeUser(db);
    await callerFor(db, other).plans.subscribe({ planId: plan.id });

    const rows = await callerFor(db, member).payments.mine();
    expect(rows).toHaveLength(1);
    expect(rows[0].planName).toBe("Monthly Unlimited");
  });
});
