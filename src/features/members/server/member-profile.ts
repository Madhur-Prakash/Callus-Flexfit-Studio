import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { users, memberships, membershipPlans, bookings } from "@/db/schema";
import { protectedProcedure } from "@/server/trpc/procedures";

/** What a member can see and change about themselves. */
export const memberProfileProcedures = {
  profile: protectedProcedure.query(async ({ ctx }) => {
    const membership = await ctx.db
      .select({
        id: memberships.id,
        status: memberships.status,
        startDate: memberships.startDate,
        endDate: memberships.endDate,
        creditsRemaining: memberships.creditsRemaining,
        planName: membershipPlans.name,
        planCredits: membershipPlans.classCredits,
      })
      .from(memberships)
      .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .where(eq(memberships.userId, ctx.user.id))
      .orderBy(desc(memberships.endDate))
      .get();

    const [{ attended }] = await ctx.db
      .select({ attended: sql<number>`count(*)` })
      .from(bookings)
      .where(
        and(eq(bookings.userId, ctx.user.id), eq(bookings.status, "attended")),
      );

    return {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      phone: ctx.user.phone,
      role: ctx.user.role,
      membership: membership ?? null,
      classesAttended: Number(attended),
    };
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        phone: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(users)
        .set(input)
        .where(eq(users.id, ctx.user.id))
        .returning()
        .get();
    }),
};
