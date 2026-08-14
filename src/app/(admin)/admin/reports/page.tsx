import type { Metadata } from "next";
import { ReportsScreen } from "@/features/back-office/ui/reports-screen";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return <ReportsScreen />;
}
