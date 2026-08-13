import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  callerFor,
  createTestDb,
  expectTrpcError,
  hoursFromNow,
  linkToCompany,
  makeClass,
  makeCompany,
  makeUser,
  schema,
  type TestDb,
} from "./support/harness";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

async function corporateMember(companyOverrides: Partial<schema.Company> = {}) {
  const company = await makeCompany(db, companyOverrides);
  const user = await makeUser(db);
  await linkToCompany(db, user.id, company.id);
  return { company, user, caller: callerFor(db, user) };
}

async function poolBalance(companyId: number) {
  const row = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId))
    .get();
  return row!.creditPoolBalance;
}

describe("corporateBookings.book", () => {
  it("debits the company pool, not the member's membership", async () => {
    const { company, caller } = await corporateMember({ creditPoolBalance: 50 });
    const cls = await makeClass(db, { creditCost: 3 });

    const booking = await caller.corporateBookings.book({ classId: cls.id });

    expect(booking).toMatchObject({
      companyId: company.id,
      status: "booked",
      creditsUsed: 3,
    });
    expect(await poolBalance(company.id)).toBe(47);
  });

  it("waitlists without debiting when the class is full", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 3 });

    const holder = await corporateMember();
    await holder.caller.corporateBookings.book({ classId: cls.id });

    const waiter = await corporateMember({ creditPoolBalance: 40 });
    const booking = await waiter.caller.corporateBookings.book({ classId: cls.id });

    expect(booking).toMatchObject({ status: "waitlisted", creditsUsed: 0 });
    expect(await poolBalance(waiter.company.id)).toBe(40);
  });

  it("rejects a member not linked to an active company", async () => {
    const loner = await makeUser(db);
    const cls = await makeClass(db);

    await expectTrpcError(
      callerFor(db, loner).corporateBookings.book({ classId: cls.id }),
      "FORBIDDEN",
      "You are not linked to an active company.",
    );
  });

  it("treats a deactivated company as no company", async () => {
    const { caller } = await corporateMember({ active: false });
    const cls = await makeClass(db);

    await expectTrpcError(
      caller.corporateBookings.book({ classId: cls.id }),
      "FORBIDDEN",
      "You are not linked to an active company.",
    );
  });

  it("rejects when the pool cannot cover the class", async () => {
    const { caller } = await corporateMember({ creditPoolBalance: 1 });
    const cls = await makeClass(db, { creditCost: 5 });

    await expectTrpcError(
      caller.corporateBookings.book({ classId: cls.id }),
      "FORBIDDEN",
      "Your company does not have enough credits.",
    );
  });

  it("rejects duplicate, cancelled and started classes", async () => {
    const { caller } = await corporateMember();

    const cancelled = await makeClass(db, { cancelled: true });
    await expectTrpcError(
      caller.corporateBookings.book({ classId: cancelled.id }),
      "BAD_REQUEST",
      "This class has been cancelled.",
    );

    const started = await makeClass(db, { startsAt: hoursFromNow(-1) });
    await expectTrpcError(
      caller.corporateBookings.book({ classId: started.id }),
      "BAD_REQUEST",
      "This class has already started.",
    );

    await expectTrpcError(
      caller.corporateBookings.book({ classId: 9999 }),
      "NOT_FOUND",
      "Class not found.",
    );

    const open = await makeClass(db);
    await caller.corporateBookings.book({ classId: open.id });
    await expectTrpcError(
      caller.corporateBookings.book({ classId: open.id }),
      "CONFLICT",
      "You are already on the list for this class.",
    );
  });
});

describe("corporateBookings.cancel", () => {
  it("refunds the pool when cancelling at least 24 hours out", async () => {
    const { company, caller } = await corporateMember({ creditPoolBalance: 50 });
    const cls = await makeClass(db, { startsAt: hoursFromNow(25), creditCost: 4 });

    const booking = await caller.corporateBookings.book({ classId: cls.id });
    expect(await poolBalance(company.id)).toBe(46);

    const result = await caller.corporateBookings.cancel({ bookingId: booking.id });

    expect(result).toEqual({ ok: true, refunded: true });
    expect(await poolBalance(company.id)).toBe(50);
  });

  it("keeps the credits when cancelling inside 24 hours", async () => {
    const { company, caller } = await corporateMember({ creditPoolBalance: 50 });
    const cls = await makeClass(db, { startsAt: hoursFromNow(23), creditCost: 4 });

    const booking = await caller.corporateBookings.book({ classId: cls.id });
    const result = await caller.corporateBookings.cancel({ bookingId: booking.id });

    expect(result).toEqual({ ok: true, refunded: false });
    expect(await poolBalance(company.id)).toBe(46);
  });

  it("promotes the longest waiting corporate member and debits their pool", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 2, startsAt: hoursFromNow(48) });

    const holder = await corporateMember({ creditPoolBalance: 50 });
    const holderBooking = await holder.caller.corporateBookings.book({ classId: cls.id });

    const waiter = await corporateMember({ creditPoolBalance: 30 });
    const waiterBooking = await waiter.caller.corporateBookings.book({ classId: cls.id });
    expect(waiterBooking.status).toBe("waitlisted");

    await holder.caller.corporateBookings.cancel({ bookingId: holderBooking.id });

    const promoted = await db
      .select()
      .from(schema.corporateBookings)
      .where(eq(schema.corporateBookings.id, waiterBooking.id))
      .get();
    expect(promoted!.status).toBe("booked");
    expect(promoted!.creditsUsed).toBe(2);
    expect(await poolBalance(waiter.company.id)).toBe(28);
  });

  it("promotes but does not debit a pool that cannot cover the class", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 10, startsAt: hoursFromNow(48) });

    const holder = await corporateMember({ creditPoolBalance: 50 });
    const holderBooking = await holder.caller.corporateBookings.book({ classId: cls.id });

    const waiter = await corporateMember({ creditPoolBalance: 10 });
    const waiterBooking = await waiter.caller.corporateBookings.book({ classId: cls.id });

    // Drain the waiting company's pool below the class cost.
    await db
      .update(schema.companies)
      .set({ creditPoolBalance: 3 })
      .where(eq(schema.companies.id, waiter.company.id));

    await holder.caller.corporateBookings.cancel({ bookingId: holderBooking.id });

    const promoted = await db
      .select()
      .from(schema.corporateBookings)
      .where(eq(schema.corporateBookings.id, waiterBooking.id))
      .get();
    expect(promoted!.status).toBe("booked");
    expect(await poolBalance(waiter.company.id)).toBe(3);
  });

  it("blocks a stranger and allows staff", async () => {
    const { caller } = await corporateMember();
    const cls = await makeClass(db);
    const booking = await caller.corporateBookings.book({ classId: cls.id });

    const stranger = await makeUser(db);
    await expectTrpcError(
      callerFor(db, stranger).corporateBookings.cancel({ bookingId: booking.id }),
      "FORBIDDEN",
      "You cannot cancel this booking.",
    );

    const trainer = await makeUser(db, { role: "trainer" });
    await expect(
      callerFor(db, trainer).corporateBookings.cancel({ bookingId: booking.id }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("corporateBookings.markAttended", () => {
  it("marks attended and records a check-in that is not linked to the booking row", async () => {
    const { caller, user } = await corporateMember();
    const cls = await makeClass(db);
    const booking = await caller.corporateBookings.book({ classId: cls.id });

    const admin = await makeUser(db, { role: "admin" });
    await callerFor(db, admin).corporateBookings.markAttended({
      bookingId: booking.id,
      source: "kiosk",
    });

    const after = await db
      .select()
      .from(schema.corporateBookings)
      .where(eq(schema.corporateBookings.id, booking.id))
      .get();
    expect(after!.status).toBe("attended");

    const checkin = await db.select().from(schema.checkins).get();
    // Known quirk, preserved: corporate check-ins store no booking link and
    // ignore the requested source. See documents/FINDINGS.md.
    expect(checkin).toMatchObject({
      userId: user.id,
      bookingId: null,
      source: "front_desk",
    });
  });
});

describe("corporateBookings.mine and rosterFor", () => {
  it("returns the member's corporate bookings with the company name", async () => {
    const { company, caller } = await corporateMember();
    const cls = await makeClass(db, { startsAt: hoursFromNow(24) });
    await caller.corporateBookings.book({ classId: cls.id });

    const rows = await caller.corporateBookings.mine({ includePast: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].companyName).toBe(company.name);
  });

  it("exposes the class roster to staff", async () => {
    const { company, user, caller } = await corporateMember();
    const cls = await makeClass(db);
    await caller.corporateBookings.book({ classId: cls.id });

    const admin = await makeUser(db, { role: "admin" });
    const roster = await callerFor(db, admin).corporateBookings.rosterFor({ classId: cls.id });

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      memberId: user.id,
      memberName: user.name,
      companyName: company.name,
      status: "booked",
    });
  });
});
