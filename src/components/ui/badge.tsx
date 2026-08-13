import type { ReactNode } from "react";
import { color } from "./tokens";

const SIZES = {
  sm: "rounded px-1.5 py-0.5 text-xs",
  md: "rounded px-2 py-1 text-xs font-medium",
} as const;

/** The amber "Full" / "Waitlist" / "#n in queue" pill. */
export function Badge({
  size = "sm",
  children,
}: {
  size?: keyof typeof SIZES;
  children: ReactNode;
}) {
  return (
    <span
      className={SIZES[size]}
      style={{ background: color.warningBg, color: color.warningText }}
    >
      {children}
    </span>
  );
}

/** The red "Cancelled" marker on a class. */
export function DangerTag({
  className = "mt-1 rounded px-2 py-1 text-xs",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      style={{ background: color.dangerBg, color: color.dangerFg }}
    >
      {children}
    </div>
  );
}
