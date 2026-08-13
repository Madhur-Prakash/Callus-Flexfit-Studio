import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./identity";
import { memberships } from "./memberships";
import { classes } from "./scheduling";
import { corporateBookings } from "./corporate";

/** Shared by personal and corporate bookings. */
const BOOKING_STATUSES = ["booked", "cancelled", "attended", "no_show", "waitlisted"] as const;

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  classId: integer("class_id")
    .notNull()
    .references(() => classes.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  membershipId: integer("membership_id").references(() => memberships.id),
  status: text("status", { enum: BOOKING_STATUSES })
    .notNull()
    .default("booked"),
  creditsUsed: integer("credits_used").notNull().default(0),
  bookedAt: text("booked_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  cancelledAt: text("cancelled_at"),
});

export const checkins = sqliteTable("checkins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  /** Set for a personal booking; null for a corporate one. */
  bookingId: integer("booking_id").references(() => bookings.id),
  /**
   * Set for a corporate booking; null for a personal one.
   *
   * Corporate bookings live in their own table, so their ids cannot go in
   * `booking_id` — its foreign key points at `bookings`. Before this column
   * existed, corporate check-ins were written with both the link and the
   * source discarded, which made them invisible to every attendance report.
   */
  corporateBookingId: integer("corporate_booking_id").references(
    () => corporateBookings.id,
  ),
  checkedInAt: text("checked_in_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  source: text("source", { enum: ["front_desk", "kiosk", "app"] })
    .notNull()
    .default("front_desk"),
});

export const reschedules = sqliteTable("reschedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  fromBookingId: integer("from_booking_id")
    .notNull()
    .references(() => bookings.id),
  toBookingId: integer("to_booking_id")
    .notNull()
    .references(() => bookings.id),
  fromClassId: integer("from_class_id")
    .notNull()
    .references(() => classes.id),
  toClassId: integer("to_class_id")
    .notNull()
    .references(() => classes.id),
  rescheduledAt: text("rescheduled_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type Booking = typeof bookings.$inferSelect;
export type BookingStatus = Booking["status"];
export type Checkin = typeof checkins.$inferSelect;
export type CheckinSource = Checkin["source"];
export type Reschedule = typeof reschedules.$inferSelect;
