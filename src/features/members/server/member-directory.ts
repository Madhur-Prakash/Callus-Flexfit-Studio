import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, like, or } from "drizzle-orm";
import { users, memberships, membershipPlans, sessions } from "@/db/schema";
import { staffProcedure, adminProcedure } from "@/server/trpc/procedures";

/** The columns safe to show staff in a list. Never includes the password hash. */
const directoryColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  role: users.role,
  active: users.active,
};

const contains = (term: string) => `%${term.trim()}%`;

/** Looking members up, and the admin controls over their accounts. */
export const memberDirectoryProcedures = {
  search: staffProcedure
    .input(z.object({ q: z.string().default(""), limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      const term = contains(input.q);
      return ctx.db
        .select(directoryColumns)
        .from(users)
        .where(
          // A blank query lists everyone rather than matching nothing.
          input.q.trim()
            ? or(like(users.name, term), like(users.email, term))
            : undefined,
        )
        .limit(input.limit);
    }),

  byId: staffProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, input.id))
        .get();

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      const history = await ctx.db
        .select({
          id: memberships.id,
          planName: membershipPlans.name,
          startDate: memberships.startDate,
          endDate: memberships.endDate,
          status: memberships.status,
          creditsRemaining: memberships.creditsRemaining,
        })
        .from(memberships)
        .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
        .where(eq(memberships.userId, user.id))
        .orderBy(desc(memberships.startDate));

      const { passwordHash: _omit, ...safe } = user;
      return { ...safe, memberships: history };
    }),

  /** Front-desk lookup: one exact-ish hit, and only ever a member. */
  lookupByEmailOrPhone: staffProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const term = contains(input.query);
      const user = await ctx.db
        .select(directoryColumns)
        .from(users)
        .where(or(like(users.email, term), like(users.phone, term)))
        .get();

      if (!user || user.role !== "member") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      return user;
    }),

  setActive: adminProcedure
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(users)
        .set({ active: input.active })
        .where(eq(users.id, input.id))
        .returning()
        .get();

      // Deactivating should take effect now, not whenever their session
      // happens to expire. The context also refuses inactive users, so this is
      // belt and braces — but it means their cookie is dead rather than merely
      // ignored.
      if (!input.active) {
        await ctx.db.delete(sessions).where(eq(sessions.userId, input.id));
      }

      return updated;
    }),

  setRole: adminProcedure
    .input(
      z.object({ id: z.number(), role: z.enum(["member", "trainer", "admin"]) }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(users)
        .set({ role: input.role })
        .where(eq(users.id, input.id))
        .returning()
        .get();
    }),
};
