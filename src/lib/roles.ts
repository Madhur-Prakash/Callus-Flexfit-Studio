import type { Role } from "@/db/schema";

export type { Role };

/** Front desk and trainers both count as staff. */
export function isStaff(role: Role | undefined | null): boolean {
  return role === "admin" || role === "trainer";
}

export function isAdmin(role: Role | undefined | null): boolean {
  return role === "admin";
}

export function isTrainer(role: Role | undefined | null): boolean {
  return role === "trainer";
}
