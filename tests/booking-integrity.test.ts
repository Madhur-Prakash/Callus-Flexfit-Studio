import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  callerFor,
  createTestDb,
  hoursFromNow,
  linkToCompany,
  makeClass,
  makeCompany,
  makeMembership,
  makeUser,
  schema,
  type TestDb,
} from "./support/harness";

/**
 * Invariants that span both ways of booking a class, and both ways of paying
 * for one. Each of these started as a failing test proving a real bug — see
 * documents/FINDINGS.md issues 1, 2, 4, 5, 7 and 13.
 */

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

async function corporateMember(poolBalance = 50) {
  const company = await makeCompany(db, { creditPoolBalance: poolBalance });
  const user = await makeUser(db);
  await linkToCompany(db, user.id, company.id);
  return { company, user, caller: callerFor(db, user) };
}

describe("a class has one capacity, not one per booking table", () => {
  it("counts personal and corporate bookings against the same limit", async () => {
    const cls = await makeClass(db, { capacity: 1 });

    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const personal = await callerFor(db, member).bookings.book({ classId: cls.id });
    expect(personal.status).toBe("booked");

    const { caller } = await corporateMember();
    const corporate = await caller.corporateBookings.book({ classId: cls.id });

    // Counting only its own table let this class hold two people.
    expect(corporate.status).toBe("waitlisted");
  });

  it("counts corporate bookings in the schedule's spotsLeft", async () => {
    const cls = await makeClass(db, { capacity: 2 });

    const { caller } = await corporateMember();
    await caller.corporateBookings.book({ classId: cls.id });

    const [listed] = await callerFor(db, null).classes.list({});
    expect(listed.spotsLeft).toBe(1);
    expect(listed.booked).toBe(1);
  });
});

describe("one member, one spot", () => {
  it("refuses a personal booking when they already hold a corporate one", async () => {
    const cls = await makeClass(db, { capacity: 10 });

    const { user, caller } = await corporateMember();
    await makeMembership(db, user.id, { creditsRemaining: 10 });

    await caller.corporateBookings.book({ classId: cls.id });

    await expect(
      callerFor(db, user).bookings.book({ classId: cls.id }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "You are already on the list for this class.",
    });
  });

  it("refuses a corporate booking when they already hold a personal one", async () => {
    const cls = await makeClass(db, { capacity: 10 });

    const { user, caller } = await corporateMember();
    await makeMembership(db, user.id, { creditsRemaining: 10 });

    await callerFor(db, user).bookings.book({ classId: cls.id });

    await expect(
      caller.corporateBookings.book({ classId: cls.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("credits are charged exactly once per class", () => {
  async function creditsOf(membershipId: number) {
    const row = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membershipId))
      .get();
    return row!.creditsRemaining;
  }

  it("charges when a free waitlist place becomes a confirmed spot", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 10 });
    const caller = callerFor(db, member);

    const full = await makeClass(db, {
      name: "Yoga",
      capacity: 1,
      creditCost: 3,
      startsAt: hoursFromNow(48),
    });
    const open = await makeClass(db, {
      name: "Yoga",
      capacity: 5,
      creditCost: 3,
      startsAt: hoursFromNow(72),
    });

    const holder = await makeUser(db);
    await makeMembership(db, holder.id);
    await callerFor(db, holder).bookings.book({ classId: full.id });

    const waitlisted = await caller.bookings.book({ classId: full.id });
    expect(waitlisted).toMatchObject({ status: "waitlisted", creditsUsed: 0 });
    expect(await creditsOf(membership.id)).toBe(10);

    // Moving to a class with room turns a free place into a paid one.
    const result = await caller.reschedules.reschedule({
      fromBookingId: waitlisted.id,
      toClassId: open.id,
    });

    expect(result.newStatus).toBe("booked");
    expect(result.newBooking.creditsUsed).toBe(3);
    expect(await creditsOf(membership.id)).toBe(7);
  });

  it("refuses that upgrade when the member cannot afford it", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 10 });
    const caller = callerFor(db, member);

    const full = await makeClass(db, {
      name: "Spin",
      capacity: 1,
      creditCost: 5,
      startsAt: hoursFromNow(48),
    });
    const open = await makeClass(db, {
      name: "Spin",
      capacity: 5,
      creditCost: 5,
      startsAt: hoursFromNow(72),
    });

    const holder = await makeUser(db);
    await makeMembership(db, holder.id);
    await callerFor(db, holder).bookings.book({ classId: full.id });

    // Joining the waitlist is free, and at this point they could afford it.
    const waitlisted = await caller.bookings.book({ classId: full.id });
    expect(waitlisted.creditsUsed).toBe(0);

    // By the time they try to move, their balance no longer covers the class.
    await db
      .update(schema.memberships)
      .set({ creditsRemaining: 1 })
      .where(eq(schema.memberships.id, membership.id));

    await expect(
      caller.reschedules.reschedule({
        fromBookingId: waitlisted.id,
        toClassId: open.id,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Not enough class credits remaining.",
    });

    // And the dry run says the same thing, so the UI can explain it.
    expect(
      await caller.reschedules.validateReschedule({
        fromBookingId: waitlisted.id,
        toClassId: open.id,
      }),
    ).toEqual({ valid: false, reason: "Not enough class credits remaining." });
  });

  it("does not charge again when an already-paid booking is promoted", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 10 });
    const caller = callerFor(db, member);

    const from = await makeClass(db, {
      name: "Boxing",
      capacity: 5,
      creditCost: 2,
      startsAt: hoursFromNow(48),
    });
    const to = await makeClass(db, {
      name: "Boxing",
      capacity: 1,
      creditCost: 2,
      startsAt: hoursFromNow(72),
    });

    const paid = await caller.bookings.book({ classId: from.id });
    expect(paid.creditsUsed).toBe(2);
    expect(await creditsOf(membership.id)).toBe(8);

    // `to` is full, so the move lands on its waitlist carrying what was paid.
    const holder = await makeUser(db);
    await makeMembership(db, holder.id);
    const holderBooking = await callerFor(db, holder).bookings.book({ classId: to.id });

    await caller.reschedules.reschedule({ fromBookingId: paid.id, toClassId: to.id });
    expect(await creditsOf(membership.id)).toBe(8);

    // Promotion into a spot they have already paid for must cost nothing more.
    await callerFor(db, holder).bookings.cancel({ bookingId: holderBooking.id });
    expect(await creditsOf(membership.id)).toBe(8);
  });
});

describe("rescheduling frees the spot it leaves behind", () => {
  it("promotes whoever was waiting on the original class", async () => {
    const cls = await makeClass(db, {
      name: "Spin",
      capacity: 1,
      startsAt: hoursFromNow(48),
    });
    const elsewhere = await makeClass(db, {
      name: "Spin",
      capacity: 5,
      startsAt: hoursFromNow(72),
    });

    const leaver = await makeUser(db);
    await makeMembership(db, leaver.id);
    const leaverBooking = await callerFor(db, leaver).bookings.book({ classId: cls.id });

    const waiter = await makeUser(db);
    await makeMembership(db, waiter.id);
    const waiterBooking = await callerFor(db, waiter).bookings.book({ classId: cls.id });
    expect(waiterBooking.status).toBe("waitlisted");

    await callerFor(db, leaver).reschedules.reschedule({
      fromBookingId: leaverBooking.id,
      toClassId: elsewhere.id,
    });

    const promoted = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, waiterBooking.id))
      .get();
    expect(promoted!.status).toBe("booked");

    const inbox = await callerFor(db, waiter).notifications.list({});
    expect(inbox[0]?.type).toBe("waitlist_promotion");
  });
});
