import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { NavBar } from "@/components/layout/nav-bar";

export const metadata: Metadata = {
  // Pages set their own title; this frames it. A page with no title of its own
  // falls back to `default`.
  title: {
    default: "FlexFit Studio",
    template: "%s · FlexFit Studio",
  },
  description: "Class booking and membership management for FlexFit Studio.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <NavBar />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
