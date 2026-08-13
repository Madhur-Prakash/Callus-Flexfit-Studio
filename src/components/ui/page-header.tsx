import type { ReactNode } from "react";

/** The page-level heading, on its own. */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>;
}

/** A page heading with a line of explanation under it. */
export function PageHeader({
  title,
  subtitle,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div>
      <PageTitle>{title}</PageTitle>
      {subtitle !== undefined && <p className="muted mt-1 text-sm">{subtitle}</p>}
    </div>
  );
}

/** A page heading with controls aligned to the right of it. */
export function PageHeaderRow({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <PageTitle>{title}</PageTitle>
      {children}
    </div>
  );
}

/** A titled block of content. Nearly every page is a stack of these. */
export function Section({
  title,
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {title !== undefined && <h2 className="font-medium">{title}</h2>}
      {children}
    </section>
  );
}
