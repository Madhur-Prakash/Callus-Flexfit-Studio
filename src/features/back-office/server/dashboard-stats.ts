import { z } from "zod";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
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

  /**
   * How full each upcoming class is.
   *
   * Written as a join and a GROUP BY rather than a correlated subquery. The
   * subquery version was silently broken: Drizzle only qualifies column names
   * when the outer query has a join, so `bookings.class_id = classes.id`
   * compiled to `bookings.class_id = bookings.id`, leaving the subquery
   * uncorrelated and every class reporting the same number.
   */
  classUtilisation: adminProcedure
    .input(z.object({ limit: z.number().default(10) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: classes.id,
          name: classes.name,
          startsAt: classes.startsAt,
          capacity: classes.capacity,
          // Counts attended too — a member who has been checked in still took
          // up a spot.
          booked: sql<number>`count(${bookings.id})`,
        })
        .from(classes)
        .leftJoin(
          bookings,
          and(
            eq(bookings.classId, classes.id),
            inArray(bookings.status, ["booked", "attended"]),
          ),
        )
        .where(eq(classes.cancelled, false))
        .groupBy(classes.id)
        .orderBy(classes.id)
        .limit(input.limit);

      return rows.map((r) => ({
        ...r,
        booked: Number(r.booked),
        utilisation: r.capacity ? Number(r.booked) / r.capacity : 0,
      }));
    }),
};
