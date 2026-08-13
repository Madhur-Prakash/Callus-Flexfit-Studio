import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { users, classes, bookings, checkins } from "@/db/schema";
import { daysAgoIso } from "@/lib/datetime";
import { adminProcedure } from "@/server/trpc/procedures";

/** Every attendance report looks back over the same rolling window. */
const REPORT_WINDOW_DAYS = 14;

/** Who turned up, who didn't, and which trainers drew a crowd. */
export const attendanceProcedures = {
  checkinsPerDay: adminProcedure.query(async ({ ctx }) => {
    const since = daysAgoIso(REPORT_WINDOW_DAYS);
    const day = sql<string>`date(${checkins.checkedInAt})`;

    const rows = await ctx.db
      .select({ date: day, count: sql<number>`count(*)` })
      .from(checkins)
      .where(sql`${day} >= ${since}`)
      .groupBy(day)
      .orderBy(sql`${day} DESC`);

    return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
  }),

  topTrainers: adminProcedure.query(async ({ ctx }) => {
    const since = daysAgoIso(REPORT_WINDOW_DAYS);

    const rows = await ctx.db
      .select({
        trainerId: classes.trainerId,
        trainerName: users.name,
        classCount: sql<number>`count(distinct ${bookings.classId})`,
        attendedCount: sql<number>`count(${bookings.id})`,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(users, eq(classes.trainerId, users.id))
      .where(
        and(
          eq(bookings.status, "attended"),
          sql`date(${classes.startsAt}) >= ${since}`,
        ),
      )
      .groupBy(classes.trainerId, users.name)
      .orderBy(sql`count(${bookings.id}) DESC`)
      .limit(10);

    return rows.map((r) => ({
      trainerId: r.trainerId,
      trainerName: r.trainerName,
      classCount: Number(r.classCount),
      attendedCount: Number(r.attendedCount),
    }));
  }),

  noShowList: adminProcedure.query(async ({ ctx }) => {
    const since = daysAgoIso(REPORT_WINDOW_DAYS);

    const rows = await ctx.db
      .select({
        bookingId: bookings.id,
        memberId: users.id,
        memberName: users.name,
        memberEmail: users.email,
        className: classes.name,
        classDate: classes.startsAt,
        trainerId: classes.trainerId,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(users, eq(bookings.userId, users.id))
      .where(
        and(
          eq(bookings.status, "no_show"),
          sql`date(${classes.startsAt}) >= ${since}`,
        ),
      )
      .orderBy(sql`${classes.startsAt} DESC`);

    // `users` is already joined on the member, so the trainer's name needs a
    // second pass rather than another join onto the same table.
    const trainerNames = await lookupTrainerNames(
      ctx.db,
      rows.map((r) => r.trainerId),
    );

    return rows.map((r) => ({
      ...r,
      trainerName: r.trainerId ? trainerNames.get(r.trainerId) : undefined,
    }));
  }),
};

async function lookupTrainerNames(
  db: Database,
  ids: Array<number | null>,
): Promise<Map<number, string>> {
  const trainerIds = [...new Set(ids)].filter((id): id is number => id != null);
  const names = new Map<number, string>();

  if (trainerIds.length === 0) return names;

  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, trainerIds));

  for (const row of rows) names.set(row.id, row.name);
  return names;
}
