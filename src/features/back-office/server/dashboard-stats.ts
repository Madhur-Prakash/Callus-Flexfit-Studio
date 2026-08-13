import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { users, memberships, classes, bookings, payments, checkins } from "@/db/schema";
import { nowIso, todayIso } from "@/lib/datetime";
import { adminProcedure } from "@/server/trpc/procedures";

/** The tiles on the admin landing page. */
export const dashboardProcedures = {
  stats: adminProcedure.query(async ({ ctx }) => {
    const today = todayIso();
    const now = nowIso();

    const countOf = async (query: Promise<Array<{ value: number }>>) =>
      Number((await query)[0].value);

    const [
      totalMembers,
      activeMemberships,
      upcomingClasses,
      revenueCents,
      totalCheckins,
      pendingPayments,
    ] = await Promise.all([
      countOf(
        ctx.db
          .select({ value: sql<number>`count(*)` })
          .from(users)
          .where(eq(users.role, "member")),
      ),
      countOf(
        ctx.db
          .select({ value: sql<number>`count(*)` })
          .from(memberships)
          .where(
            and(
              eq(memberships.status, "active"),
              sql`${memberships.endDate} >= ${today}`,
            ),
          ),
      ),
      countOf(
        ctx.db
          .select({ value: sql<number>`count(*)` })
          .from(classes)
          .where(and(gte(classes.startsAt, now), eq(classes.cancelled, false))),
      ),
      countOf(
        ctx.db
          .select({ value: sql<number>`coalesce(sum(${payments.amountCents}), 0)` })
          .from(payments)
          .where(eq(payments.status, "paid")),
      ),
      countOf(ctx.db.select({ value: sql<number>`count(*)` }).from(checkins)),
      countOf(
        ctx.db
          .select({ value: sql<number>`count(*)` })
          .from(payments)
          .where(eq(payments.status, "pending")),
      ),
    ]);

    return {
      totalMembers,
      activeMemberships,
      upcomingClasses,
      revenueCents,
      totalCheckins,
      pendingPayments,
    };
  }),

  classUtilisation: adminProcedure
    .input(z.object({ limit: z.number().default(10) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: classes.id,
          name: classes.name,
          startsAt: classes.startsAt,
          capacity: classes.capacity,
          // KNOWN BUG, PRESERVED. Because this query has no join, Drizzle emits
          // the subquery's columns unqualified, so `bookings.class_id =
          // classes.id` becomes `bookings.class_id = bookings.id` and the
          // subquery stops being correlated. Every class reports the same
          // count. Adding a join, or an explicit alias, changes the numbers on
          // the admin dashboard — see documents/FINDINGS.md.
          booked: sql<number>`(
            select count(*) from ${bookings}
            where ${bookings.classId} = ${classes.id}
              and ${bookings.status} in ('booked','attended')
          )`.as("booked"),
        })
        .from(classes)
        .where(eq(classes.cancelled, false))
        .limit(input.limit);

      return rows.map((r) => ({
        ...r,
        booked: Number(r.booked),
        utilisation: r.capacity ? Number(r.booked) / r.capacity : 0,
      }));
    }),
};
