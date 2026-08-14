import { z } from "zod";

/**
 * Environment access, validated once at startup.
 *
 * Server-only — importing this from a client component would be a mistake, and
 * `db/client.ts` is the only consumer. Reading `process.env` directly scatters
 * untyped strings and silent `undefined`s through the codebase; this fails loudly
 * at boot instead.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** libSQL URL. A bare path is a local file, which is how the studio runs. */
  DB_FILE: z.string().min(1).default("file:flexfit.db"),
});

const parsed = envSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  DB_FILE: process.env.DB_FILE,
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment:\n${parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")}`,
  );
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";
