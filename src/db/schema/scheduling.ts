import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

export const classes = sqliteTable("classes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  trainerId: integer("trainer_id").references(() => users.id),
  room: text("room").notNull(),
  capacity: integer("capacity").notNull(),
  startsAt: text("starts_at").notNull(),
  durationMin: integer("duration_min").notNull().default(60),
  creditCost: integer("credit_cost").notNull().default(1),
  cancelled: integer("cancelled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const trainerAvailability = sqliteTable("trainer_availability", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trainerId: integer("trainer_id")
    .notNull()
    .references(() => users.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type GymClass = typeof classes.$inferSelect;
