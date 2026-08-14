import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

export const membershipPlans = sqliteTable("membership_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  durationDays: integer("duration_days").notNull(),
  classCredits: integer("class_credits").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const memberships = sqliteTable("memberships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  planId: integer("plan_id")
    .notNull()
    .references(() => membershipPlans.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  creditsRemaining: integer("credits_remaining").notNull().default(0),
  status: text("status", { enum: ["active", "expired", "cancelled", "frozen"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  membershipId: integer("membership_id").references(() => memberships.id),
  amountCents: integer("amount_cents").notNull(),
  method: text("method", { enum: ["card", "cash", "upi", "transfer"] }).notNull(),
  status: text("status", { enum: ["pending", "paid", "failed", "refunded"] })
    .notNull()
    .default("pending"),
  reference: text("reference"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Payment = typeof payments.$inferSelect;
