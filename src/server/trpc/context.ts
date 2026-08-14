import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, type Database } from "@/db/client";
import { sessions, users, type User } from "@/db/schema";

export const SESSION_COOKIE = "flexfit_session";

/**
 * Resolves the signed-in user from the session cookie. An expired session is
 * treated as no session; the row is left in place.
 *
 * A deactivated account is also treated as no session. `auth.login` refuses
 * inactive users, but that only guards the front door: without this check an
 * admin could deactivate someone who was already signed in and they would keep
 * full access until their 30-day session ran out.
 */
export async function createContext() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  let user: User | null = null;

  if (token) {
    const row = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
      .get();

    const live = row && new Date(row.session.expiresAt) > new Date();
    if (live && row.user.active) {
      user = row.user;
    }
  }

  return { db, user, token };
}

export type Context = {
  db: Database;
  user: User | null;
  token: string | undefined;
};
