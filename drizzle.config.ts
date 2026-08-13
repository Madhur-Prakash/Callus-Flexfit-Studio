import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    // Matches src/db/client.ts, so tooling and the app always agree on which
    // file they are pointed at.
    url: process.env.DB_FILE ?? "file:flexfit.db",
  },
} satisfies Config;
