import type { CSSProperties } from "react";

/**
 * Colours the pages set inline.
 *
 * globals.css defines --bg/--panel/--border/--text/--muted/--accent; anything
 * outside that palette was hard-coded at the call site, in several different
 * spellings for the same colour. They are collected here so a change lands in
 * one place. The values are unchanged.
 */
export const color = {
  /** Error text. `--accent` is #4ade80, which is why success reads as green. */
  danger: "#f87171",
  dangerStrong: "#ef4444",
  success: "var(--accent)",

  warningBg: "#3a2a1a",
  warningText: "#fbbf24",

  dangerBg: "#7f1d1d",
  dangerBorder: "#dc2626",
  dangerFg: "#fca5a5",

  successBg: "#064e3b",
  successBorder: "#16a34a",
  successFg: "#bbf7d0",

  successTint: "rgba(34, 197, 94, 0.1)",
  dangerTint: "rgba(239, 68, 68, 0.1)",
} as const;

/** The border colour every bordered panel and control uses. */
export const borderStyle: CSSProperties = { borderColor: "var(--border)" };

/**
 * The secondary control surface used by the kiosk and trainer screens.
 *
 * Note: --bg-secondary and --fg are not defined in globals.css, so these two
 * declarations are dropped by the browser and the control inherits instead.
 * Preserved verbatim; see documents/FINDINGS.md.
 */
export const subtleControlStyle: CSSProperties = {
  background: "var(--bg-secondary)",
  color: "var(--fg)",
  borderColor: "var(--border)",
};
