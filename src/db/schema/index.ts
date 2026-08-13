/**
 * The studio's tables, grouped by the part of the business they belong to.
 *
 * This barrel is what `drizzle(client, { schema })` and drizzle-kit consume, so
 * every table must be re-exported here. Splitting the file up is purely
 * organisational: the table definitions themselves are unchanged, and the
 * database on disk is untouched.
 */
export * from "./identity";
export * from "./memberships";
export * from "./scheduling";
export * from "./bookings";
export * from "./corporate";
export * from "./notifications";
