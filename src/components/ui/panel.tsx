import type { ReactNode } from "react";
import { borderStyle } from "./tokens";

/** A card whose children are rows separated by hairlines. */
export function PanelList({ children }: { children: ReactNode }) {
  return (
    <div className="panel divide-y" style={borderStyle}>
      {children}
    </div>
  );
}

/** Placeholder inside a PanelList when there is nothing to list. */
export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="p-4 text-center muted">{children}</div>;
}

/** Standalone placeholder card when there is nothing to show. */
export function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="panel p-4 text-center muted">{children}</div>;
}

/** One-line "there's nothing here" note, outside any card. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="muted text-sm">{children}</p>;
}

/** A labelled number on the admin screens. */
export function StatTile({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="muted text-xs uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
