import type { Metadata } from "next";
import { AttendanceScreen } from "@/features/back-office/ui/attendance-screen";

export const metadata: Metadata = { title: "Attendance" };

export default function Page() {
  return <AttendanceScreen />;
}
