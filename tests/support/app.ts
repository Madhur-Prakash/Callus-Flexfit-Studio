/**
 * The single place the test suite knows about the app's internals.
 *
 * Everything else in tests/ imports from here. That is deliberate: during the
 * 2026 restructure the whole source tree moved, and the only file that had to
 * change was this one. If a test body ever needs editing to accommodate a
 * refactor, the refactor changed behaviour.
 */
export { appRouter } from "@/server/root-router";
export * as schema from "@/db/schema";
export { hashPassword } from "@/lib/password";
