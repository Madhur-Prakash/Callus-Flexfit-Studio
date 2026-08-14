import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env, isProduction } from "@/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  client: ReturnType<typeof createClient> | undefined;
};

// Reused across hot reloads in development, where the module graph is rebuilt
// on every edit and a fresh connection each time would leak handles.
const client = globalForDb.client ?? createClient({ url: env.DB_FILE });

if (!isProduction) {
  globalForDb.client = client;
}

export const db = drizzle(client, { schema });
export { schema };

/**
 * The concrete database handle every server module is written against. Handing
 * this type around (rather than re-deriving `typeof import("@/db").db` at each
 * call site) is what lets services be called with a test database.
 */
export type Database = typeof db;

/** The handle inside `db.transaction(async (tx) => …)`. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Either a plain connection or an open transaction.
 *
 * Services take this so a caller can compose several of them into one atomic
 * unit — booking a class writes a booking row and debits credits, and those
 * two writes must not be able to come apart.
 */
export type DbClient = Database | Transaction;
