import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./identity";
import { classes } from "./scheduling";

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  contactEmail: text("contact_email").notNull(),
  creditPoolBalance: integer("credit_pool_balance").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const companyMembers = sqliteTable("company_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const corporateBookings = sqliteTable("corporate_bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  classId: integer("class_id")
    .notNull()
    .references(() => classes.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  status: text("status", {
    enum: ["booked", "cancelled", "attended", "no_show", "waitlisted"],
  })
    .notNull()
    .default("booked"),
  creditsUsed: integer("credits_used").notNull().default(0),
  bookedAt: text("booked_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  cancelledAt: text("cancelled_at"),
});

export type Company = typeof companies.$inferSelect;
