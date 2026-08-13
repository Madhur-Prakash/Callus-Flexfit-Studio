import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { isAdmin, isStaff } from "@/lib/roles";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;

/** Anyone, signed in or not. */
export const publicProcedure = t.procedure;

/** Any signed-in user. Narrows `ctx.user` to non-null for callers. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Trainers and admins. */
export const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isStaff(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Staff only." });
  }
  return next({ ctx });
});

/** Admins only. */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdmin(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admins only." });
  }
  return next({ ctx });
});
