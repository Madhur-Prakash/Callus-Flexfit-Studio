import { z } from "zod";
import { and, desc, eq, not, sql } from "drizzle-orm";
import { notifications, users } from "@/db/schema";
import { router, protectedProcedure, adminProcedure } from "@/server/trpc/procedures";

const unreadForUser = (userId: number) =>
  and(eq(notifications.userId, userId), not(notifications.read));

export const notificationsRouter = router({
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [{ count }] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(unreadForUser(ctx.user.id));

    return Number(count) || 0;
  }),

  list: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).default({}))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, ctx.user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit);
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ read: true })
      .where(unreadForUser(ctx.user.id));

    return { ok: true };
  }),

  broadcast: adminProcedure
    .input(z.object({ title: z.string(), message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Goes to everyone with the member role. Note this includes deactivated
      // accounts — see documents/FINDINGS.md.
      const recipients = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "member"));

      if (recipients.length === 0) {
        return { ok: true, count: 0 };
      }

      await ctx.db.insert(notifications).values(
        recipients.map((recipient) => ({
          userId: recipient.id,
          type: "announcement" as const,
          title: input.title,
          message: input.message,
        })),
      );

      return { ok: true, count: recipients.length };
    }),
});
