import type { Metadata } from "next";
import { ScheduleScreen } from "@/features/classes/ui/schedule-screen";

export const metadata: Metadata = { title: "Class schedule" };

export default function Page() {
  return <ScheduleScreen />;
}
