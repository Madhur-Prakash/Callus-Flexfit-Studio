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

beforeEach(async () => {
  db = await createTestDb();
});

describe("classes.list", () => {
  it("computes spotsLeft and full from confirmed bookings", async () => {
    const cls = await makeClass(db, { capacity: 2 });

    const first = await makeUser(db);
    await makeMembership(db, first.id);
    await callerFor(db, first).bookings.book({ classId: cls.id });

    const [listed] = await callerFor(db, null).classes.list({});
    expect(listed).toMatchObject({ spotsLeft: 1, full: false, booked: 1 });

    const second = await makeUser(db);
    await makeMembership(db, second.id);
    await callerFor(db, second).bookings.book({ classId: cls.id });

    const [now] = await callerFor(db, null).classes.list({});
    expect(now).toMatchObject({ spotsLeft: 0, full: true, booked: 2 });
  });

  it("keeps a class full once attendees are checked in", async () => {
    const cls = await makeClass(db, { capacity: 1 });

    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    const admin = await makeUser(db, { role: "admin" });
    await callerFor(db, admin).bookings.markAttended({ bookingId: booking.id });

    // Counting only 'booked' made the spot look free again the moment the
    // member walked through the door, letting the class be over-booked.
    const [listed] = await callerFor(db, null).classes.list({});
    expect(listed).toMatchObject({ spotsLeft: 0, full: true, booked: 1 });
  });

  it("never reports negative spots left", async () => {
    const cls = await makeClass(db, { capacity: 1 });
    const member = await makeUser(db);
    await makeMembership(db, member.id);
    await callerFor(db, member).bookings.book({ classId: cls.id });

    // Force an over-subscribed class the way a data fix might.
    const other = await makeUser(db);
    await db
      .insert(schema.bookings)
      .values({ classId: cls.id, userId: other.id, status: "booked" });

    const [listed] = await callerFor(db, null).classes.list({});
    expect(listed.spotsLeft).toBe(0);
    expect(listed.full).toBe(true);
  });

  it("hides cancelled classes unless asked, and filters by date range", async () => {
    await makeClass(db, { name: "Live", startsAt: hoursFromNow(24) });
    await makeClass(db, { name: "Scrapped", startsAt: hoursFromNow(24), cancelled: true });
    await makeClass(db, { name: "Distant", startsAt: hoursFromNow(24 * 30) });

    const caller = callerFor(db, null);

    expect((await caller.classes.list({})).map((c) => c.name)).toEqual(["Live", "Distant"]);
    expect((await caller.classes.list({ includeCancelled: true })).map((c) => c.name)).toEqual([
      "Live",
      "Scrapped",
      "Distant",
    ]);
    expect(
      (await caller.classes.list({ to: hoursFromNow(48) })).map((c) => c.name),
    ).toEqual(["Live"]);
  });

  it("exposes the trainer name, or null when unassigned", async () => {
    const trainer = await makeUser(db, { role: "trainer", name: "Arjun Mehta" });
    await makeClass(db, { name: "Coached", trainerId: trainer.id });
    await makeClass(db, { name: "Orphan", startsAt: hoursFromNow(72) });

    const rows = await callerFor(db, null).classes.list({});
    expect(rows.find((c) => c.name === "Coached")!.trainerName).toBe("Arjun Mehta");
    expect(rows.find((c) => c.name === "Orphan")!.trainerName).toBeNull();
  });
});

describe("classes.cancel", () => {
  it("cancels the class and every confirmed booking on it", async () => {
    const cls = await makeClass(db, { capacity: 5 });

    const member = await makeUser(db);
    await makeMembership(db, member.id);
    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    const admin = await makeUser(db, { role: "admin" });
    const result = await callerFor(db, admin).classes.cancel({ id: cls.id });

    expect(result.cancelled).toBe(true);

    const after = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, booking.id))
      .get();
    expect(after!.status).toBe("cancelled");
    expect(after!.cancelledAt).toBeTruthy();
  });

  it("refunds credits even inside the free-cancellation window", async () => {
    // One hour out, a member cancelling would forfeit their credits. The studio
    // calling the class off is not the member's fault, so they are made whole.
    const cls = await makeClass(db, {
      capacity: 5,
      creditCost: 3,
      startsAt: hoursFromNow(1),
    });

    const member = await makeUser(db);
    const membership = await makeMembership(db, member.id, { creditsRemaining: 10 });
    await callerFor(db, member).bookings.book({ classId: cls.id });

    const spent = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id))
      .get();
    expect(spent!.creditsRemaining).toBe(7);

    const admin = await makeUser(db, { role: "admin" });
    await callerFor(db, admin).classes.cancel({ id: cls.id });

    const refunded = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id))
      .get();
    expect(refunded!.creditsRemaining).toBe(10);
  });

  it("cancels waitlisted bookings too", async () => {
    const cls = await makeClass(db, { capacity: 1 });

    const holder = await makeUser(db);
    await makeMembership(db, holder.id);
    await callerFor(db, holder).bookings.book({ classId: cls.id });

    const waiter = await makeUser(db);
    await makeMembership(db, waiter.id);
    const waiting = await callerFor(db, waiter).bookings.book({ classId: cls.id });

    const admin = await makeUser(db, { role: "admin" });
    await callerFor(db, admin).classes.cancel({ id: cls.id });

    // Leaving these waitlisted left members queuing for a class that would
    // never run.
    const after = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, waiting.id))
      .get();
    expect(after!.status).toBe("cancelled");
  });

  it("tells everyone affected, once each", async () => {
    const cls = await makeClass(db, { capacity: 5 });

    const first = await makeUser(db);
    await makeMembership(db, first.id);
    await callerFor(db, first).bookings.book({ classId: cls.id });

    const second = await makeUser(db);
    await makeMembership(db, second.id);
    await callerFor(db, second).bookings.book({ classId: cls.id });

    const bystander = await makeUser(db);

    const admin = await makeUser(db, { role: "admin" });
    await callerFor(db, admin).classes.cancel({ id: cls.id });

    for (const member of [first, second]) {
      const inbox = await callerFor(db, member).notifications.list({});
      expect(inbox).toHaveLength(1);
      expect(inbox[0].type).toBe("class_cancelled");
      expect(inbox[0].message).toContain(cls.name);
    }

    expect(await callerFor(db, bystander).notifications.list({})).toHaveLength(0);
  });

  it("refunds corporate bookings to the company pool", async () => {
    const cls = await makeClass(db, { capacity: 5, creditCost: 4 });

    const company = await db
      .insert(schema.companies)
      .values({ name: "TestCorp", contactEmail: "hr@testcorp.test", creditPoolBalance: 50 })
      .returning()
      .get();
    const employee = await makeUser(db);
    await db
      .insert(schema.companyMembers)
      .values({ userId: employee.id, companyId: company.id });

    const corporateBooking = await callerFor(db, employee).corporateBookings.book({
      classId: cls.id,
    });

    const admin = await makeUser(db, { role: "admin" });
    await callerFor(db, admin).classes.cancel({ id: cls.id });

    const after = await db
      .select()
      .from(schema.corporateBookings)
      .where(eq(schema.corporateBookings.id, corporateBooking.id))
      .get();
    expect(after!.status).toBe("cancelled");

    const pool = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, company.id))
      .get();
    expect(pool!.creditPoolBalance).toBe(50);
  });

  it("is admin-only; trainers may create and update but not cancel", async () => {
    const cls = await makeClass(db);
    const trainer = await makeUser(db, { role: "trainer" });

    await expectTrpcError(
      callerFor(db, trainer).classes.cancel({ id: cls.id }),
      "FORBIDDEN",
      "Admins only.",
    );

    await expect(
      callerFor(db, trainer).classes.create({
        name: "New",
        room: "Studio A",
        capacity: 10,
        startsAt: hoursFromNow(24),
      }),
    ).resolves.toMatchObject({ name: "New", durationMin: 60, creditCost: 1 });

    await expect(
      callerFor(db, trainer).classes.update({ id: cls.id, room: "Spin Room" }),
    ).resolves.toMatchObject({ room: "Spin Room" });
  });

  it("reports a missing class on update", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    await expectTrpcError(
      callerFor(db, trainer).classes.update({ id: 9999, room: "X" }),
      "NOT_FOUND",
      "Class not found.",
    );
  });
});

describe("trainers.checkAvailability", () => {
  async function trainerWithMonday9to5() {
    const trainer = await makeUser(db, { role: "trainer" });
    // 2026-03-02 is a Monday.
    await db.insert(schema.trainerAvailability).values({
      trainerId: trainer.id,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "17:00",
    });
    return trainer;
  }

  it("accepts a slot fully inside the trainer's hours", async () => {
    const trainer = await trainerWithMonday9to5();
    const admin = await makeUser(db, { role: "admin" });

    expect(
      await callerFor(db, admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: "2026-03-02T10:00:00.000Z",
        durationMin: 60,
      }),
    ).toEqual({ available: true });
  });

  it("rejects a day with no availability set", async () => {
    const trainer = await trainerWithMonday9to5();
    const admin = await makeUser(db, { role: "admin" });

    expect(
      await callerFor(db, admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: "2026-03-03T10:00:00.000Z", // Tuesday
        durationMin: 60,
      }),
    ).toEqual({ available: false, reason: "No availability set for this day" });
  });

  it("rejects a slot that runs past the trainer's end time", async () => {
    const trainer = await trainerWithMonday9to5();
    const admin = await makeUser(db, { role: "admin" });

    expect(
      await callerFor(db, admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: "2026-03-02T16:30:00.000Z",
        durationMin: 60,
      }),
    ).toEqual({ available: false, reason: "Outside availability hours" });
  });

  it("rejects a slot overlapping a class the trainer already teaches", async () => {
    const trainer = await trainerWithMonday9to5();
    await makeClass(db, {
      trainerId: trainer.id,
      startsAt: "2026-03-02T10:00:00.000Z",
      durationMin: 60,
    });
    const admin = await makeUser(db, { role: "admin" });

    expect(
      await callerFor(db, admin).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: "2026-03-02T10:30:00.000Z",
        durationMin: 60,
      }),
    ).toEqual({ available: false, reason: "Trainer already has a class at this time" });
  });

  it("is closed to members", async () => {
    const trainer = await trainerWithMonday9to5();
    const member = await makeUser(db);

    await expectTrpcError(
      callerFor(db, member).trainers.checkAvailability({
        trainerId: trainer.id,
        startsAt: "2026-03-02T10:00:00.000Z",
        durationMin: 60,
      }),
      "FORBIDDEN",
      "Staff only.",
    );
  });
});

describe("trainers.availability", () => {
  it("upserts one row per weekday and removes it again", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    const caller = callerFor(db, trainer);

    await caller.trainers.setAvailability({ dayOfWeek: 2, startTime: "06:00", endTime: "12:00" });
    await caller.trainers.setAvailability({ dayOfWeek: 2, startTime: "08:00", endTime: "14:00" });

    const rows = await caller.trainers.availability();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startTime: "08:00", endTime: "14:00" });

    expect(await caller.trainers.removeAvailability({ dayOfWeek: 2 })).toEqual({ success: true });
    expect(await caller.trainers.availability()).toHaveLength(0);

    // Removing a day that was never set is a no-op, not an error.
    expect(await caller.trainers.removeAvailability({ dayOfWeek: 2 })).toEqual({ success: true });
  });

  it("is trainer-only, even for admins", async () => {
    const admin = await makeUser(db, { role: "admin" });
    await expectTrpcError(
      callerFor(db, admin).trainers.availability(),
      "FORBIDDEN",
      "Only trainers can access this.",
    );
    await expectTrpcError(
      callerFor(db, admin).trainers.upcomingClasses(),
      "FORBIDDEN",
      "Only trainers can access this.",
    );
  });
});

describe("trainers.upcomingClasses", () => {
  it("returns only the trainer's own future, uncancelled classes", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    const other = await makeUser(db, { role: "trainer" });

    await makeClass(db, { name: "Mine", trainerId: trainer.id, startsAt: hoursFromNow(24) });
    await makeClass(db, { name: "Past", trainerId: trainer.id, startsAt: hoursFromNow(-24) });
    await makeClass(db, {
      name: "Scrapped",
      trainerId: trainer.id,
      startsAt: hoursFromNow(24),
      cancelled: true,
    });
    await makeClass(db, { name: "Theirs", trainerId: other.id, startsAt: hoursFromNow(24) });

    const rows = await callerFor(db, trainer).trainers.upcomingClasses();
    expect(rows.map((c) => c.name)).toEqual(["Mine"]);
  });
});
