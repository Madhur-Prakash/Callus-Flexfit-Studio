import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(process.cwd(), "node_modules", ".cache", "flexfit-tests");

export const DDL_FILE = join(CACHE_DIR, "schema.sql");

/** Throwaway database files, one per test. */
export const DB_DIR = join(CACHE_DIR, "dbs");

/**
 * Derives the test DDL from src/db/schema/ via drizzle-kit, so the tables the
 * tests run against can never drift from the tables the app runs against.
 * Runs once per `vitest` invocation.
 */
export default function setup() {
  const outDir = join(CACHE_DIR, "drizzle");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Left over from a previous run if it was killed mid-flight.
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });

  // Invoke drizzle-kit's entry script with the current node binary rather than
  // going through the `.bin` shim, which spawnSync cannot execute on Windows.
  execFileSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "drizzle-kit", "bin.cjs"),
      "generate",
      "--dialect",
      "turso",
      "--schema",
      "./src/db/schema/index.ts",
      "--out",
      outDir,
    ],
    { stdio: "pipe" },
  );

  const sqlFile = readdirSync(outDir).find((f) => f.endsWith(".sql"));
  if (!sqlFile) throw new Error("drizzle-kit produced no SQL file");

  writeFileSync(DDL_FILE, readFileSync(join(outDir, sqlFile), "utf8"));

  return () => {
    // Best effort: Windows can still hold a handle briefly after close.
    try {
      rmSync(DB_DIR, { recursive: true, force: true });
    } catch {
      // The next run wipes it anyway.
    }
  };
}
