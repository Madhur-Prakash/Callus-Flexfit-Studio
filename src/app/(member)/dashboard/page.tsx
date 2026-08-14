import type { Metadata } from "next";
import { DashboardScreen } from "@/features/bookings/ui/dashboard-screen";

export const metadata: Metadata = { title: "My bookings" };

export default function Page() {
  return <DashboardScreen />;
}
