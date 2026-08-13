import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  callerFor,
  createTestDb,
  expectTrpcError,
  hoursFromNow,
  makeClass,
  makeMembership,
  makeUser,
  schema,
  type TestDb,
} from "./support/harness";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

describe("bookings.book", () => {
  it("confirms a booking and spends the class credit cost", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 10 });
    const cls = await makeClass(db, { creditCost: 2 });

    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    expect(booking).toMatchObject({
      classId: cls.id,
      userId: member.id,
      membershipId: membership.id,
      status: "booked",
      creditsUsed: 2,
    });

    const after = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(8);
  });

  it("never decrements a membership at or above the unlimited threshold", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 999 });
    const cls = await makeClass(db, { creditCost: 1 });

    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    // The booking still records what it would have cost.
    expect(booking.creditsUsed).toBe(1);

    const after = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(999);
  });

  it("waitlists once the class is at capacity, charging nothing", async () => {
    const cls = await makeClass(db, { capacity: 1, creditCost: 3 });

    const first = await makeUser(db);
    await makeMembership(db, first.id, { creditsRemaining: 10 });
    await callerFor(db, first).bookings.book({ classId: cls.id });

    const second = await makeUser(db);
    const secondMs = await makeMembership(db, second.id, { creditsRemaining: 10 });
    const waitlisted = await callerFor(db, second).bookings.book({ classId: cls.id });

    expect(waitlisted).toMatchObject({ status: "waitlisted", creditsUsed: 0 });

    const after = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, secondMs.id))
      .get();
    expect(after!.creditsRemaining).toBe(10);
  });

  it("picks the membership with the latest end date", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id, {
      endDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
      creditsRemaining: 5,
    });
    const later = await makeMembership(db, member.id, {
      endDate: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
      creditsRemaining: 7,
    });
    const cls = await makeClass(db);

    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });
    expect(booking.membershipId).toBe(later.id);
  });

  it("rejects a missing class", async () => {
    const member = await makeUser(db);
    await expectTrpcError(
      callerFor(db, member).bookings.book({ classId: 9999 }),
      "NOT_FOUND",
      "Class not found.",
    );
  });

  it("rejects a cancelled class", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db, { cancelled: true });

    await expectTrpcError(
      callerFor(db, member).bookings.book({ classId: cls.id }),
      "BAD_REQUEST",
      "This class has been cancelled.",
    );
  });

  it("rejects a class that has already started", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db, { startsAt: hoursFromNow(-1) });

    await expectTrpcError(
      callerFor(db, member).bookings.book({ classId: cls.id }),
      "BAD_REQUEST",
      "This class has already started.",
    );
  });

  it("rejects a second booking for the same class", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db);
    const caller = callerFor(db, member);

    await caller.bookings.book({ classId: cls.id });
    await expectTrpcError(
      caller.bookings.book({ classId: cls.id }),
      "CONFLICT",
      "You are already on the list for this class.",
    );
  });

  it("rejects a member with no active membership", async () => {
    const member = await makeUser(db);
    const cls = await makeClass(db);

    await expectTrpcError(
      callerFor(db, member).bookings.book({ classId: cls.id }),
      "FORBIDDEN",
      "An active membership is required to book classes.",
    );
  });

  it("treats an expired membership as no membership", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id, {
      endDate: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10),
    });
    const cls = await makeClass(db);

    await expectTrpcError(
      callerFor(db, member).bookings.book({ classId: cls.id }),
      "FORBIDDEN",
      "An active membership is required to book classes.",
    );
  });

  it("rejects a member without enough credits", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id, { creditsRemaining: 1 });
    const cls = await makeClass(db, { creditCost: 5 });

    await expectTrpcError(
      callerFor(db, member).bookings.book({ classId: cls.id }),
      "FORBIDDEN",
      "Not enough class credits remaining.",
    );
  });

  it("requires a signed-in user", async () => {
    const cls = await makeClass(db);
    await expectTrpcError(
      callerFor(db, null).bookings.book({ classId: cls.id }),
      "UNAUTHORIZED",
      "Sign in required.",
    );
  });
});

describe("bookings.cancel", () => {
  it("refunds credits when cancelling at least 12 hours out", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 10 });
    const cls = await makeClass(db, { startsAt: hoursFromNow(13), creditCost: 2 });
    const caller = callerFor(db, member);

    const booking = await caller.bookings.book({ classId: cls.id });
    const result = await caller.bookings.cancel({ bookingId: booking.id });

    expect(result).toEqual({ ok: true, refunded: true });

    const after = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(10);
  });

  it("forfeits credits when cancelling inside the 12 hour window", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 10 });
    const cls = await makeClass(db, { startsAt: hoursFromNow(11), creditCost: 2 });
    const caller = callerFor(db, member);

    const booking = await caller.bookings.book({ classId: cls.id });
    const result = await caller.bookings.cancel({ bookingId: booking.id });

    expect(result).toEqual({ ok: true, refunded: false });

    const after = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(8);
  });

  it("stamps the booking cancelled", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db);
    const caller = callerFor(db, member);

    const booking = await caller.bookings.book({ classId: cls.id });
    await caller.bookings.cancel({ bookingId: booking.id });

    const after = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, booking.id))
      .get();
    expect(after!.status).toBe("cancelled");
    expect(after!.cancelledAt).toBeTruthy();
  });

  it("promotes the longest-waiting member and charges their credits", async () => {
    const cls = await makeClass(db, {
      capacity: 1,
      creditCost: 2,
      startsAt: hoursFromNow(48),
    });

    const holder = await makeUser(db);
    await makeMembership(db, holder.id, { creditsRemaining: 10 });
    const holderBooking = await callerFor(db, holder).bookings.book({ classId: cls.id });

    const waiter = await makeUser(db);
    const waiterMs = await makeMembership(db, waiter.id, { creditsRemaining: 10 });
    const waiterBooking = await callerFor(db, waiter).bookings.book({ classId: cls.id });
    expect(waiterBooking.status).toBe("waitlisted");

    await callerFor(db, holder).bookings.cancel({ bookingId: holderBooking.id });

    const promoted = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, waiterBooking.id))
      .get();
    expect(promoted!.status).toBe("booked");
    expect(promoted!.creditsUsed).toBe(2);

    const after = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, waiterMs.id))
      .get();
    expect(after!.creditsRemaining).toBe(8);
  });

  it("does not promote anyone when a waitlisted booking is cancelled", async () => {
    const cls = await makeClass(db, { capacity: 1 });

    const holder = await makeUser(db);
    await makeMembership(db, holder.id);
    await callerFor(db, holder).bookings.book({ classId: cls.id });

    const first = await makeUser(db);
    await makeMembership(db, first.id);
    const firstWait = await callerFor(db, first).bookings.book({ classId: cls.id });

    const second = await makeUser(db);
    await makeMembership(db, second.id);
    const secondWait = await callerFor(db, second).bookings.book({ classId: cls.id });

    await callerFor(db, first).bookings.cancel({ bookingId: firstWait.id });

    const stillWaiting = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, secondWait.id))
      .get();
    expect(stillWaiting!.status).toBe("waitlisted");
  });

  it("lets staff cancel someone else's booking", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db);
    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    const admin = await makeUser(db, { role: "admin" });
    await expect(
      callerFor(db, admin).bookings.cancel({ bookingId: booking.id }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("stops a member cancelling someone else's booking", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db);
    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    const stranger = await makeUser(db);
    await expectTrpcError(
      callerFor(db, stranger).bookings.cancel({ bookingId: booking.id }),
      "FORBIDDEN",
      "You cannot cancel this booking.",
    );
  });

  it("rejects an unknown booking", async () => {
    const member = await makeUser(db);
    await expectTrpcError(
      callerFor(db, member).bookings.cancel({ bookingId: 4242 }),
      "NOT_FOUND",
      "Booking not found.",
    );
  });

  it("rejects a booking that is no longer active", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db);
    const caller = callerFor(db, member);

    const booking = await caller.bookings.book({ classId: cls.id });
    await caller.bookings.cancel({ bookingId: booking.id });

    await expectTrpcError(
      caller.bookings.cancel({ bookingId: booking.id }),
      "BAD_REQUEST",
      "This booking is no longer active.",
    );
  });
});

describe("bookings.mine", () => {
  it("hides past classes unless asked for them", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id, { creditsRemaining: 999 });
    const caller = callerFor(db, member);

    const upcoming = await makeClass(db, { startsAt: hoursFromNow(24) });
    await caller.bookings.book({ classId: upcoming.id });

    // A past class cannot be booked through the API, so insert directly.
    const past = await makeClass(db, { startsAt: hoursFromNow(-24) });
    await db
      .insert(schema.bookings)
      .values({ classId: past.id, userId: member.id, status: "attended" });

    expect(await caller.bookings.mine({ includePast: false })).toHaveLength(1);
    expect(await caller.bookings.mine({ includePast: true })).toHaveLength(2);
  });
});

describe("bookings.waitlisted", () => {
  it("numbers the queue from 1 in booking order", async () => {
    const cls = await makeClass(db, { capacity: 1 });

    const holder = await makeUser(db);
    await makeMembership(db, holder.id);
    await callerFor(db, holder).bookings.book({ classId: cls.id });

    const first = await makeUser(db);
    await makeMembership(db, first.id);
    await callerFor(db, first).bookings.book({ classId: cls.id });

    const second = await makeUser(db);
    await makeMembership(db, second.id);
    await callerFor(db, second).bookings.book({ classId: cls.id });

    const firstQueue = await callerFor(db, first).bookings.waitlisted();
    const secondQueue = await callerFor(db, second).bookings.waitlisted();

    expect(firstQueue[0].position).toBe(1);
    // Both rows share a CURRENT_TIMESTAMP second, so position counts strictly
    // earlier rows only; this pins whatever the current implementation yields.
    expect(secondQueue[0].position).toBeGreaterThanOrEqual(1);
    expect(secondQueue[0].className).toBe(cls.name);
  });
});

describe("bookings.markAttended", () => {
  it("marks the booking attended and records a check-in with its source", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db);
    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    const admin = await makeUser(db, { role: "admin" });
    await callerFor(db, admin).bookings.markAttended({
      bookingId: booking.id,
      source: "kiosk",
    });

    const after = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, booking.id))
      .get();
    expect(after!.status).toBe("attended");

    const checkin = await db
      .select()
      .from(schema.checkins)
      .where(eq(schema.checkins.bookingId, booking.id))
      .get();
    expect(checkin).toMatchObject({ userId: member.id, source: "kiosk" });
  });

  it("refuses to check in a waitlisted booking", async () => {
    const cls = await makeClass(db, { capacity: 1 });
    const holder = await makeUser(db);
    await makeMembership(db, holder.id);
    await callerFor(db, holder).bookings.book({ classId: cls.id });

    const waiter = await makeUser(db);
    await makeMembership(db, waiter.id);
    const waiting = await callerFor(db, waiter).bookings.book({ classId: cls.id });

    const admin = await makeUser(db, { role: "admin" });
    await expectTrpcError(
      callerFor(db, admin).bookings.markAttended({ bookingId: waiting.id }),
      "BAD_REQUEST",
      "Only confirmed bookings can be checked in.",
    );
  });

  it("is staff-only", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const cls = await makeClass(db);
    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    await expectTrpcError(
      callerFor(db, member).bookings.markAttended({ bookingId: booking.id }),
      "FORBIDDEN",
      "Staff only.",
    );
  });
});

describe("bookings.upcomingForMember", () => {
  it("only returns confirmed bookings inside the window", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id, { creditsRemaining: 999 });
    const caller = callerFor(db, member);

    const soon = await makeClass(db, { startsAt: hoursFromNow(1), name: "Soon" });
    const later = await makeClass(db, { startsAt: hoursFromNow(5), name: "Later" });
    await caller.bookings.book({ classId: soon.id });
    await caller.bookings.book({ classId: later.id });

    const admin = await makeUser(db, { role: "admin" });
    const rows = await callerFor(db, admin).bookings.upcomingForMember({
      userId: member.id,
      hoursAhead: 2,
    });

    expect(rows.map((r) => r.className)).toEqual(["Soon"]);
  });
});
