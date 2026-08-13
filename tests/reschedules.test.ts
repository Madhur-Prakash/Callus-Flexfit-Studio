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

/**
 * A member holding a confirmed booking on "Sunrise Yoga" 48h out, plus a second
 * "Sunrise Yoga" they could move to.
 */
async function scenario(overrides: { target?: Partial<schema.GymClass> } = {}) {
  const member = await makeUser(db);
  await makeMembership(db, member.id, { creditsRemaining: 10 });

  const from = await makeClass(db, {
    name: "Sunrise Yoga",
    startsAt: hoursFromNow(48),
    creditCost: 2,
  });
  const to = await makeClass(db, {
    name: "Sunrise Yoga",
    startsAt: hoursFromNow(72),
    creditCost: 2,
    ...overrides.target,
  });

  const caller = callerFor(db, member);
  const booking = await caller.bookings.book({ classId: from.id });
  return { member, caller, from, to, booking };
}

describe("reschedules.reschedule", () => {
  it("moves the booking, keeps the credits already spent, and logs the move", async () => {
    const { caller, from, to, booking, member } = await scenario();

    const result = await caller.reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    expect(result.ok).toBe(true);
    expect(result.newStatus).toBe("booked");
    expect(result.newBooking).toMatchObject({
      classId: to.id,
      userId: member.id,
      status: "booked",
      creditsUsed: 2,
    });

    const original = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, booking.id))
      .get();
    expect(original!.status).toBe("cancelled");
    expect(original!.cancelledAt).toBeTruthy();

    const log = await db.select().from(schema.reschedules).get();
    expect(log).toMatchObject({
      userId: member.id,
      fromBookingId: booking.id,
      toBookingId: result.newBooking.id,
      fromClassId: from.id,
      toClassId: to.id,
    });
  });

  it("does not refund or re-charge membership credits", async () => {
    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 10 });
    const from = await makeClass(db, { name: "Spin", startsAt: hoursFromNow(48), creditCost: 3 });
    const to = await makeClass(db, { name: "Spin", startsAt: hoursFromNow(72), creditCost: 3 });
    const caller = callerFor(db, member);

    const booking = await caller.bookings.book({ classId: from.id });
    await caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id });

    const after = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id))
      .get();
    expect(after!.creditsRemaining).toBe(7);
  });

  it("waitlists into a full target class", async () => {
    const { caller, to, booking } = await scenario({ target: { capacity: 1 } });

    const other = await makeUser(db);
    await makeMembership(db, other.id);
    await callerFor(db, other).bookings.book({ classId: to.id });

    const result = await caller.reschedules.reschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    expect(result.newStatus).toBe("waitlisted");
    expect(result.newBooking.status).toBe("waitlisted");
  });

  it("rejects a move requested less than 4 hours before the original class", async () => {
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const from = await makeClass(db, { name: "Yoga", startsAt: hoursFromNow(3) });
    const to = await makeClass(db, { name: "Yoga", startsAt: hoursFromNow(72) });
    const caller = callerFor(db, member);
    const booking = await caller.bookings.book({ classId: from.id });

    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id }),
      "BAD_REQUEST",
      "You can only reschedule up to 4 hours before the class starts.",
    );
  });

  it("rejects a target class with a different name", async () => {
    const { caller, booking } = await scenario();
    const other = await makeClass(db, { name: "Boxing", startsAt: hoursFromNow(72) });

    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: other.id }),
      "BAD_REQUEST",
      "You can only reschedule to a class with the same name.",
    );
  });

  it("rejects rescheduling onto the same class", async () => {
    const { caller, from, booking } = await scenario();

    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: from.id }),
      "BAD_REQUEST",
      "You are already booked for this class.",
    );
  });

  it("rejects a cancelled target class", async () => {
    const { caller, to, booking } = await scenario();
    await db
      .update(schema.classes)
      .set({ cancelled: true })
      .where(eq(schema.classes.id, to.id));

    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id }),
      "BAD_REQUEST",
      "This class has been cancelled.",
    );
  });

  it("rejects a target class that has already started", async () => {
    const { caller, to, booking } = await scenario();
    await db
      .update(schema.classes)
      .set({ startsAt: hoursFromNow(-2) })
      .where(eq(schema.classes.id, to.id));

    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id }),
      "BAD_REQUEST",
      "This class has already started.",
    );
  });

  it("rejects a target the member already holds a booking for", async () => {
    const { caller, to, booking } = await scenario();
    await caller.bookings.book({ classId: to.id });

    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id }),
      "CONFLICT",
      "You already have an active booking for this class.",
    );
  });

  it("rejects an unknown booking", async () => {
    const { caller, to } = await scenario();
    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: 9999, toClassId: to.id }),
      "NOT_FOUND",
      "Booking not found.",
    );
  });

  it("rejects an unknown target class", async () => {
    const { caller, booking } = await scenario();
    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: 9999 }),
      "NOT_FOUND",
      "Target class not found.",
    );
  });

  it("rejects a booking belonging to someone else", async () => {
    const { to, booking } = await scenario();
    const stranger = await makeUser(db);

    await expectTrpcError(
      callerFor(db, stranger).reschedules.reschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
      "FORBIDDEN",
      "You cannot reschedule this booking.",
    );
  });

  it("rejects an already cancelled booking", async () => {
    const { caller, to, booking } = await scenario();
    await caller.bookings.cancel({ bookingId: booking.id });

    await expectTrpcError(
      caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id }),
      "BAD_REQUEST",
      "This booking is no longer active.",
    );
  });
});

/**
 * validateReschedule is the dry-run twin of the mutation. Every rejection the
 * mutation can throw must surface here as `{ valid: false, reason }` with the
 * identical message — that equivalence is the contract.
 */
describe("reschedules.validateReschedule mirrors the mutation", () => {
  const cases: Array<{
    name: string;
    reason: string;
    setup: () => Promise<{ fromBookingId: number; toClassId: number; asStranger?: boolean }>;
  }> = [
    {
      name: "unknown booking",
      reason: "Booking not found.",
      setup: async () => {
        const { to } = await scenario();
        return { fromBookingId: 9999, toClassId: to.id };
      },
    },
    {
      name: "someone else's booking",
      reason: "You cannot reschedule this booking.",
      setup: async () => {
        const { to, booking } = await scenario();
        return { fromBookingId: booking.id, toClassId: to.id, asStranger: true };
      },
    },
    {
      name: "inactive booking",
      reason: "This booking is no longer active.",
      setup: async () => {
        const { caller, to, booking } = await scenario();
        await caller.bookings.cancel({ bookingId: booking.id });
        return { fromBookingId: booking.id, toClassId: to.id };
      },
    },
    {
      name: "inside the 4 hour window",
      reason: "You can only reschedule up to 4 hours before the class starts.",
      setup: async () => {
        const { from, to, booking } = await scenario();
        await db
          .update(schema.classes)
          .set({ startsAt: hoursFromNow(3) })
          .where(eq(schema.classes.id, from.id));
        return { fromBookingId: booking.id, toClassId: to.id };
      },
    },
    {
      name: "unknown target class",
      reason: "Target class not found.",
      setup: async () => {
        const { booking } = await scenario();
        return { fromBookingId: booking.id, toClassId: 9999 };
      },
    },
    {
      name: "different class name",
      reason: "You can only reschedule to a class with the same name.",
      setup: async () => {
        const { booking } = await scenario();
        const other = await makeClass(db, { name: "Boxing", startsAt: hoursFromNow(72) });
        return { fromBookingId: booking.id, toClassId: other.id };
      },
    },
    {
      name: "same class",
      reason: "You are already booked for this class.",
      setup: async () => {
        const { from, booking } = await scenario();
        return { fromBookingId: booking.id, toClassId: from.id };
      },
    },
    {
      name: "target already started",
      reason: "This class has already started.",
      setup: async () => {
        const { to, booking } = await scenario();
        await db
          .update(schema.classes)
          .set({ startsAt: hoursFromNow(-2) })
          .where(eq(schema.classes.id, to.id));
        return { fromBookingId: booking.id, toClassId: to.id };
      },
    },
    {
      name: "target cancelled",
      reason: "This class has been cancelled.",
      setup: async () => {
        const { to, booking } = await scenario();
        await db
          .update(schema.classes)
          .set({ cancelled: true })
          .where(eq(schema.classes.id, to.id));
        return { fromBookingId: booking.id, toClassId: to.id };
      },
    },
    {
      name: "already booked into the target",
      reason: "You already have an active booking for this class.",
      setup: async () => {
        const { caller, to, booking } = await scenario();
        await caller.bookings.book({ classId: to.id });
        return { fromBookingId: booking.id, toClassId: to.id };
      },
    },
  ];

  for (const testCase of cases) {
    it(`reports "${testCase.reason}" for ${testCase.name}`, async () => {
      const { fromBookingId, toClassId, asStranger } = await testCase.setup();
      const actor = asStranger
        ? await makeUser(db)
        : (await db.select().from(schema.users).where(eq(schema.users.role, "member")).get())!;

      const result = await callerFor(db, actor).reschedules.validateReschedule({
        fromBookingId,
        toClassId,
      });

      expect(result).toEqual({ valid: false, reason: testCase.reason });
    });
  }

  it("reports a valid move and whether the target is full", async () => {
    const { caller, to, booking } = await scenario();

    expect(
      await caller.reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).toEqual({ valid: true, targetIsFull: false });
  });

  it("flags a full target as valid but full", async () => {
    const { caller, to, booking } = await scenario({ target: { capacity: 1 } });
    const other = await makeUser(db);
    await makeMembership(db, other.id);
    await callerFor(db, other).bookings.book({ classId: to.id });

    expect(
      await caller.reschedules.validateReschedule({
        fromBookingId: booking.id,
        toClassId: to.id,
      }),
    ).toEqual({ valid: true, targetIsFull: true });
  });

  it("leaves no trace in the database", async () => {
    const { caller, to, booking } = await scenario();
    await caller.reschedules.validateReschedule({
      fromBookingId: booking.id,
      toClassId: to.id,
    });

    expect(await db.select().from(schema.reschedules)).toHaveLength(0);
    const original = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, booking.id))
      .get();
    expect(original!.status).toBe("booked");
  });
});

describe("reschedules.history", () => {
  it("returns the member's moves with both ends of each move", async () => {
    const { caller, from, to, booking } = await scenario();
    await caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id });

    const history = await caller.reschedules.history();

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromClassName: from.name,
      fromClassTime: from.startsAt,
      fromClassRoom: from.room,
      toClassName: to.name,
      toClassTime: to.startsAt,
      toClassRoom: to.room,
    });
  });

  it("is scoped to the signed-in member", async () => {
    const { caller, to, booking } = await scenario();
    await caller.reschedules.reschedule({ fromBookingId: booking.id, toClassId: to.id });

    const stranger = await makeUser(db);
    expect(await callerFor(db, stranger).reschedules.history()).toHaveLength(0);
  });
});
