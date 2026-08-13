import type { ReactNode } from "react";
import { color } from "./tokens";

type Tone = "error" | "success";

/** A message on a panel, used for mutation errors and confirmations. */
export function InlineAlert({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <p
      className="panel p-3 text-sm"
      style={{ color: tone === "error" ? color.danger : color.success }}
    >
      {children}
    </p>
  );
}

/** A tinted strip used by the admin forms. */
export function TintedBanner({
  tone,
  className = "",
  children,
}: {
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  const isError = tone === "error";
  return (
    <div
      className={`p-3 rounded ${className}`.trim()}
      style={{ backgroundColor: isError ? color.dangerTint : color.successTint }}
    >
      <p style={{ color: isError ? color.dangerStrong : color.success }}>{children}</p>
    </div>
  );
}

/** A bordered notice on the kiosk, where it has to be readable across a desk. */
export function Callout({
  tone,
  className = "rounded border p-3 text-sm",
  children,
}: {
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  const palette =
    tone === "error"
      ? { borderColor: color.dangerBorder, background: color.dangerBg, color: color.dangerFg }
      : {
          borderColor: color.successBorder,
          background: color.successBg,
          color: color.successFg,
        };

  return (
    <div className={className} style={palette}>
      {children}
    </div>
  );
}

export function LoadingMessage({ children = "Loading..." }: { children?: ReactNode }) {
  return <p className="muted">{children}</p>;
}

/** Shown in place of a page when the signed-in user is the wrong role. */
export function AccessDenied({ audience }: { audience: string }) {
  return <p className="muted">Access denied. {audience}</p>;
}
