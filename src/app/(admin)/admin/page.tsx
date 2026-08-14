import type { Metadata } from "next";
import { AdminOverviewScreen } from "@/features/back-office/ui/admin-overview-screen";

export const metadata: Metadata = { title: "Admin" };

export default function Page() {
  return <AdminOverviewScreen />;
}
