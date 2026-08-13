import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  callerFor,
  createTestDb,
  expectTrpcError,
  hoursFromNow,
  isoDate,
  linkToCompany,
  makeClass,
  makeCompany,
  makeMembership,
  makePlan,
  makeUser,
  schema,
  type TestDb,
} from "./support/harness";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

describe("members.profile", () => {
  it("returns the latest membership and the attended class count", async () => {
    const member = await makeUser(db, { name: "Rahul Krishnan" });
    const plan = await makePlan(db, { name: "Drop-in Pack", classCredits: 10 });
    await makeMembership(db, member.id, {
      planId: plan.id,
      endDate: isoDate(5),
      creditsRemaining: 3,
    });
    const latest = await makeMembership(db, member.id, {
      planId: plan.id,
      endDate: isoDate(90),
      creditsRemaining: 8,
    });

    const cls = await makeClass(db);
    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });
    const admin = await makeUser(db, { role: "admin" });
    await callerFor(db, admin).bookings.markAttended({ bookingId: booking.id });

    const profile = await callerFor(db, member).members.profile();

    expect(profile).toMatchObject({
      id: member.id,
      name: "Rahul Krishnan",
      role: "member",
      classesAttended: 1,
    });
    expect(profile.membership).toMatchObject({
      id: latest.id,
      planName: "Drop-in Pack",
      planCredits: 10,
    });
  });

  it("returns a null membership for a member who never subscribed", async () => {
    const member = await makeUser(db);
    const profile = await callerFor(db, member).members.profile();
    expect(profile.membership).toBeNull();
    expect(profile.classesAttended).toBe(0);
  });
});

describe("members.search and lookup", () => {
  it("matches on name or email and returns everyone when the query is blank", async () => {
    await makeUser(db, { name: "Meera Nair", email: "meera.n@example.test" });
    await makeUser(db, { name: "Vikram Shetty", email: "vikram.s@example.test" });
    const staff = await makeUser(db, { role: "admin" });
    const caller = callerFor(db, staff);

    expect((await caller.members.search({ q: "Meera" })).map((u) => u.name)).toEqual([
      "Meera Nair",
    ]);
    expect((await caller.members.search({ q: "vikram.s@" })).map((u) => u.name)).toEqual([
      "Vikram Shetty",
    ]);
    expect(await caller.members.search({ q: "" })).toHaveLength(3);
    expect(await caller.members.search({ q: "nobody" })).toHaveLength(0);
  });

  it("never leaks a password hash through byId", async () => {
    const member = await makeUser(db);
    const staff = await makeUser(db, { role: "trainer" });

    const result = await callerFor(db, staff).members.byId({ id: member.id });
    expect(result).not.toHaveProperty("passwordHash");
    expect(result.memberships).toEqual([]);
  });

  it("refuses to look up a non-member by email or phone", async () => {
    const trainer = await makeUser(db, { role: "trainer", email: "coach@flexfit.test" });
    const admin = await makeUser(db, { role: "admin" });

    await expectTrpcError(
      callerFor(db, admin).members.lookupByEmailOrPhone({ query: "coach@flexfit.test" }),
      "NOT_FOUND",
      "Member not found.",
    );
    expect(trainer.role).toBe("trainer");
  });

  it("finds a member by phone fragment", async () => {
    const member = await makeUser(db, { phone: "+91 90000 55555" });
    const admin = await makeUser(db, { role: "admin" });

    const found = await callerFor(db, admin).members.lookupByEmailOrPhone({ query: "55555" });
    expect(found.id).toBe(member.id);
  });

  it("keeps the member directory staff-only and role changes admin-only", async () => {
    const member = await makeUser(db);
    await expectTrpcError(
      callerFor(db, member).members.search({ q: "a" }),
      "FORBIDDEN",
      "Staff only.",
    );

    const trainer = await makeUser(db, { role: "trainer" });
    await expectTrpcError(
      callerFor(db, trainer).members.setRole({ id: member.id, role: "admin" }),
      "FORBIDDEN",
      "Admins only.",
    );
  });
});

describe("members.updateProfile", () => {
  it("updates only the fields provided", async () => {
    const member = await makeUser(db, { name: "Old Name", phone: "+91 1" });
    await callerFor(db, member).members.updateProfile({ name: "New Name" });

    const after = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, member.id))
      .get();
    expect(after).toMatchObject({ name: "New Name", phone: "+91 1" });
  });
});

describe("admin.stats", () => {
  it("counts members, memberships, classes, revenue and check-ins", async () => {
    const admin = await makeUser(db, { role: "admin" });
    await makeUser(db, { role: "trainer" });

    const member = await makeUser(db);
    const plan = await makePlan(db, { priceCents: 450000 });
    await callerFor(db, member).plans.subscribe({ planId: plan.id });

    await db
      .insert(schema.payments)
      .values({ userId: member.id, amountCents: 999, method: "cash", status: "pending" });

    await makeClass(db, { startsAt: hoursFromNow(24) });
    await makeClass(db, { startsAt: hoursFromNow(-24) });
    await makeClass(db, { startsAt: hoursFromNow(24), cancelled: true });

    const stats = await callerFor(db, admin).admin.stats();

    expect(stats).toEqual({
      totalMembers: 1,
      activeMemberships: 1,
      upcomingClasses: 1,
      revenueCents: 450000,
      totalCheckins: 0,
      pendingPayments: 1,
    });
  });

  it("is admin-only", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    await expectTrpcError(callerFor(db, trainer).admin.stats(), "FORBIDDEN", "Admins only.");
  });
});

describe("admin.classUtilisation", () => {
  /**
   * Regression guard. The `booked` subquery has no join to force Drizzle to
   * qualify its columns, so without the explicit table alias it emits
   * `where "class_id" = "id"` — both resolving to bookings — and silently
   * stops being correlated. Every class then reports the same number.
   * Two classes with different booking counts is what catches that.
   */
  it("counts each class's own bookings, attended included", async () => {
    const clsOne = await makeClass(db, { capacity: 4 });
    const clsTwo = await makeClass(db, { capacity: 8, startsAt: hoursFromNow(72) });

    const first = await makeUser(db);
    await makeMembership(db, first.id);
    const firstBooking = await callerFor(db, first).bookings.book({ classId: clsOne.id });

    const second = await makeUser(db);
    await makeMembership(db, second.id);
    await callerFor(db, second).bookings.book({ classId: clsOne.id });

    const third = await makeUser(db);
    await makeMembership(db, third.id);
    await callerFor(db, third).bookings.book({ classId: clsTwo.id });

    const admin = await makeUser(db, { role: "admin" });
    // Checking someone in must not drop them from the count.
    await callerFor(db, admin).bookings.markAttended({ bookingId: firstBooking.id });

    const rows = await callerFor(db, admin).admin.classUtilisation({});

    expect(rows[0]).toMatchObject({ capacity: 4, booked: 2, utilisation: 0.5 });
    expect(rows[1]).toMatchObject({ capacity: 8, booked: 1, utilisation: 0.125 });
  });

  it("respects the limit and skips cancelled classes", async () => {
    await makeClass(db);
    await makeClass(db, { startsAt: hoursFromNow(72) });
    await makeClass(db, { startsAt: hoursFromNow(96), cancelled: true });

    const admin = await makeUser(db, { role: "admin" });
    expect(await callerFor(db, admin).admin.classUtilisation({})).toHaveLength(2);
    expect(await callerFor(db, admin).admin.classUtilisation({ limit: 1 })).toHaveLength(1);
  });
});

describe("admin reports", () => {
  it("groups revenue by month and by method, counting paid only", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const member = await makeUser(db);

    await db.insert(schema.payments).values([
      { userId: member.id, amountCents: 1000, method: "card", status: "paid" },
      { userId: member.id, amountCents: 2000, method: "card", status: "paid" },
      { userId: member.id, amountCents: 500, method: "upi", status: "paid" },
      { userId: member.id, amountCents: 9999, method: "cash", status: "pending" },
      { userId: member.id, amountCents: 8888, method: "cash", status: "refunded" },
    ]);

    const caller = callerFor(db, admin);

    const byMonth = await caller.admin.revenueByMonth();
    expect(byMonth).toHaveLength(1);
    expect(byMonth[0].totalCents).toBe(3500);

    expect(await caller.admin.revenueByMethod()).toEqual([
      { method: "card", totalCents: 3000, count: 2 },
      { method: "upi", totalCents: 500, count: 1 },
    ]);

    expect(await caller.admin.refundCount()).toEqual({ count: 1 });
  });

  it("lists memberships expiring inside 14 days", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const plan = await makePlan(db, { name: "Monthly Unlimited" });

    const soon = await makeUser(db, { name: "Expiring Soon" });
    await makeMembership(db, soon.id, { planId: plan.id, endDate: isoDate(7) });

    const later = await makeUser(db, { name: "Safe" });
    await makeMembership(db, later.id, { planId: plan.id, endDate: isoDate(40) });

    const gone = await makeUser(db, { name: "Already Expired" });
    await makeMembership(db, gone.id, { planId: plan.id, endDate: isoDate(-3) });

    const rows = await callerFor(db, admin).admin.expiringMemberships();
    expect(rows.map((r) => r.memberName)).toEqual(["Expiring Soon"]);
    expect(rows[0].planName).toBe("Monthly Unlimited");
  });

  it("summarises check-ins per day and no-shows with trainer names", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const trainer = await makeUser(db, { role: "trainer", name: "Sana Kapoor" });

    const member = await makeUser(db, { name: "Divya Menon" });
    await makeMembership(db, member.id);
    const cls = await makeClass(db, { trainerId: trainer.id, startsAt: hoursFromNow(2) });
    const booking = await callerFor(db, member).bookings.book({ classId: cls.id });

    const caller = callerFor(db, admin);
    await caller.bookings.markAttended({ bookingId: booking.id });

    const perDay = await caller.admin.checkinsPerDay();
    expect(perDay).toHaveLength(1);
    expect(perDay[0].count).toBe(1);

    await db
      .update(schema.bookings)
      .set({ status: "no_show" })
      .where(eq(schema.bookings.id, booking.id));

    const noShows = await caller.admin.noShowList();
    expect(noShows).toHaveLength(1);
    expect(noShows[0]).toMatchObject({
      memberName: "Divya Menon",
      trainerName: "Sana Kapoor",
    });
  });

  it("returns an undefined trainer name for an unassigned class", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const member = await makeUser(db);
    const cls = await makeClass(db, { startsAt: hoursFromNow(2) });
    await db
      .insert(schema.bookings)
      .values({ classId: cls.id, userId: member.id, status: "no_show" });

    const [row] = await callerFor(db, admin).admin.noShowList();
    expect(row.trainerId).toBeNull();
    expect(row.trainerName).toBeUndefined();
  });

  it("ranks trainers by attended bookings", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const busy = await makeUser(db, { role: "trainer", name: "Busy" });
    const quiet = await makeUser(db, { role: "trainer", name: "Quiet" });

    const busyClass = await makeClass(db, { trainerId: busy.id, startsAt: hoursFromNow(2) });
    const quietClass = await makeClass(db, { trainerId: quiet.id, startsAt: hoursFromNow(2) });

    for (let i = 0; i < 2; i++) {
      const m = await makeUser(db);
      await db
        .insert(schema.bookings)
        .values({ classId: busyClass.id, userId: m.id, status: "attended" });
    }
    const single = await makeUser(db);
    await db
      .insert(schema.bookings)
      .values({ classId: quietClass.id, userId: single.id, status: "attended" });

    const rows = await callerFor(db, admin).admin.topTrainers();
    expect(rows.map((r) => r.trainerName)).toEqual(["Busy", "Quiet"]);
    expect(rows[0].attendedCount).toBe(2);
  });
});

describe("adminCompanies", () => {
  it("creates, tops up, and deactivates a company", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const caller = callerFor(db, admin);

    const created = await caller.adminCompanies.create({
      name: "TechCorp Inc",
      contactEmail: "hr@techcorp.test",
      creditPoolBalance: 100,
    });
    expect(created).toMatchObject({ name: "TechCorp Inc", creditPoolBalance: 100, active: true });

    expect(
      (await caller.adminCompanies.topUp({ id: created.id, amount: 50 })).creditPoolBalance,
    ).toBe(150);

    expect(
      (await caller.adminCompanies.updateActive({ id: created.id, active: false })).active,
    ).toBe(false);
  });

  it("links a member once and unlinks them again", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const company = await makeCompany(db);
    const member = await makeUser(db);
    const caller = callerFor(db, admin);

    const link = await caller.adminCompanies.linkMember({
      companyId: company.id,
      userId: member.id,
    });

    await expectTrpcError(
      caller.adminCompanies.linkMember({ companyId: company.id, userId: member.id }),
      "CONFLICT",
      "This member is already linked to this company.",
    );

    expect(await caller.adminCompanies.unlinkMember({ companyMemberId: link.id })).toEqual({
      ok: true,
    });
  });

  it("refuses to link staff to a company", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const company = await makeCompany(db);
    const trainer = await makeUser(db, { role: "trainer" });

    await expectTrpcError(
      callerFor(db, admin).adminCompanies.linkMember({
        companyId: company.id,
        userId: trainer.id,
      }),
      "BAD_REQUEST",
      "Only members can be linked to companies.",
    );
  });

  it("reports missing companies, users and links", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const caller = callerFor(db, admin);
    const company = await makeCompany(db);

    await expectTrpcError(
      caller.adminCompanies.getById({ id: 9999 }),
      "NOT_FOUND",
      "Company not found.",
    );
    await expectTrpcError(
      caller.adminCompanies.topUp({ id: 9999, amount: 1 }),
      "NOT_FOUND",
      "Company not found.",
    );
    await expectTrpcError(
      caller.adminCompanies.linkMember({ companyId: company.id, userId: 9999 }),
      "NOT_FOUND",
      "User not found.",
    );
    await expectTrpcError(
      caller.adminCompanies.unlinkMember({ companyMemberId: 9999 }),
      "NOT_FOUND",
      "Company member link not found.",
    );
  });

  it("returns members and recent bookings alongside the company", async () => {
    const admin = await makeUser(db, { role: "admin" });
    const company = await makeCompany(db);
    const member = await makeUser(db, { name: "Aisha Begum" });
    await linkToCompany(db, member.id, company.id);

    const cls = await makeClass(db, { name: "Spin 45" });
    await callerFor(db, member).corporateBookings.book({ classId: cls.id });

    const detail = await callerFor(db, admin).adminCompanies.getById({ id: company.id });

    expect(detail.members.map((m) => m.name)).toEqual(["Aisha Begum"]);
    expect(detail.recentBookings).toHaveLength(1);
    expect(detail.recentBookings[0]).toMatchObject({
      className: "Spin 45",
      memberName: "Aisha Begum",
      status: "booked",
    });
  });

  it("is admin-only", async () => {
    const trainer = await makeUser(db, { role: "trainer" });
    await expectTrpcError(
      callerFor(db, trainer).adminCompanies.list(),
      "FORBIDDEN",
      "Admins only.",
    );
  });
});

describe("notifications", () => {
  it("counts unread, lists newest first, and marks all read", async () => {
    const member = await makeUser(db);
    await db.insert(schema.notifications).values([
      { userId: member.id, type: "announcement", title: "One", message: "m", read: false },
      { userId: member.id, type: "announcement", title: "Two", message: "m", read: true },
    ]);

    const caller = callerFor(db, member);
    expect(await caller.notifications.unreadCount()).toBe(1);
    expect(await caller.notifications.list({})).toHaveLength(2);

    expect(await caller.notifications.markAllAsRead()).toEqual({ ok: true });
    expect(await caller.notifications.unreadCount()).toBe(0);
  });

  it("is scoped to the signed-in user", async () => {
    const member = await makeUser(db);
    const other = await makeUser(db);
    await db.insert(schema.notifications).values({
      userId: member.id,
      type: "announcement",
      title: "Private",
      message: "m",
    });

    expect(await callerFor(db, other).notifications.list({})).toHaveLength(0);
  });

  it("broadcasts to active members and to nobody else", async () => {
    const admin = await makeUser(db, { role: "admin" });
    await makeUser(db, { role: "trainer" });
    const first = await makeUser(db);
    const second = await makeUser(db);
    const deactivated = await makeUser(db, { active: false });

    const result = await callerFor(db, admin).notifications.broadcast({
      title: "Studio maintenance",
      message: "Studio A closed Friday.",
    });

    expect(result).toEqual({ ok: true, count: 2 });
    expect(await callerFor(db, first).notifications.list({})).toHaveLength(1);
    expect(await callerFor(db, second).notifications.list({})).toHaveLength(1);
    expect(await callerFor(db, admin).notifications.list({})).toHaveLength(0);
    expect(await callerFor(db, deactivated).notifications.list({})).toHaveLength(0);
  });

  it("returns zero when there is nobody to broadcast to", async () => {
    const admin = await makeUser(db, { role: "admin" });
    expect(
      await callerFor(db, admin).notifications.broadcast({ title: "t", message: "m" }),
    ).toEqual({ ok: true, count: 0 });
  });

  it("keeps broadcasting admin-only", async () => {
    const member = await makeUser(db);
    await expectTrpcError(
      callerFor(db, member).notifications.broadcast({ title: "t", message: "m" }),
      "FORBIDDEN",
      "Admins only.",
    );
  });
});

describe("auth.me", () => {
  it("returns the signed-in user, or null when anonymous", async () => {
    const member = await makeUser(db);
    expect(await callerFor(db, member).auth.me()).toMatchObject({ id: member.id });
    expect(await callerFor(db, null).auth.me()).toBeNull();
  });
});
