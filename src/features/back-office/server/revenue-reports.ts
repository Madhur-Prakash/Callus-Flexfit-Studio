import { and, eq, gte, lte, sql } from "drizzle-orm";
import { users, memberships, membershipPlans, payments } from "@/db/schema";
import { daysFromNowIso, todayIso } from "@/lib/datetime";
import { adminProcedure } from "@/server/trpc/procedures";

/** Money in, and who is about to stop paying it. */
export const revenueProcedures = {
  revenueByMonth: adminProcedure.query(async ({ ctx }) => {
    const month = sql<string>`strftime('%Y-%m', ${payments.createdAt})`;

    const rows = await ctx.db
      .select({
        month,
        totalCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .groupBy(month)
      .orderBy(sql`${month} DESC`);

    return rows.map((r) => ({ month: r.month, totalCents: Number(r.totalCents) }));
  }),

  revenueByMethod: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        method: payments.method,
        totalCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(payments)
      .where(eq(payments.status, "paid"))
      .groupBy(payments.method)
      .orderBy(sql`sum(${payments.amountCents}) DESC`);

    return rows.map((r) => ({
      method: r.method,
      totalCents: Number(r.totalCents),
      count: Number(r.count),
    }));
  }),

  expiringMemberships: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        memberId: users.id,
        memberName: users.name,
        memberEmail: users.email,
        planName: membershipPlans.name,
        expiresAt: memberships.endDate,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .where(
        and(
          eq(memberships.status, "active"),
          gte(memberships.endDate, todayIso()),
          lte(memberships.endDate, daysFromNowIso(14)),
        ),
      )
      .orderBy(memberships.endDate);
  }),

  refundCount: adminProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(payments)
      .where(eq(payments.status, "refunded"));

    return { count: Number(result.count) };
  }),
};
