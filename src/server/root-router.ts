import { router } from "./trpc/procedures";
import { authRouter } from "@/features/auth/server/auth.router";
import { membersRouter } from "@/features/members/server/members.router";
import { plansRouter } from "@/features/plans/server/plans.router";
import { classesRouter } from "@/features/classes/server/classes.router";
import { bookingsRouter } from "@/features/bookings/server/bookings.router";
import { reschedulesRouter } from "@/features/reschedules/server/reschedules.router";
import { corporateBookingsRouter } from "@/features/corporate/server/corporate-bookings.router";
import { paymentsRouter } from "@/features/payments/server/payments.router";
import { adminRouter } from "@/features/back-office/server/admin.router";
import { adminCompaniesRouter } from "@/features/corporate/server/admin-companies.router";
import { notificationsRouter } from "@/features/notifications/server/notifications.router";
import { trainersRouter } from "@/features/trainers/server/trainers.router";

/**
 * The app's entire API surface. Namespace keys are part of the client contract
 * (`trpc.bookings.book`), so they are fixed even though the modules behind them
 * have moved.
 */
export const appRouter = router({
  auth: authRouter,
  members: membersRouter,
  plans: plansRouter,
  classes: classesRouter,
  bookings: bookingsRouter,
  reschedules: reschedulesRouter,
  corporateBookings: corporateBookingsRouter,
  payments: paymentsRouter,
  admin: adminRouter,
  adminCompanies: adminCompaniesRouter,
  notifications: notificationsRouter,
  trainers: trainersRouter,
});

export type AppRouter = typeof appRouter;
