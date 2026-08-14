import type { Metadata } from "next";
import { TrainerScheduleScreen } from "@/features/trainers/ui/trainer-schedule-screen";

export const metadata: Metadata = { title: "My schedule" };

export default function Page() {
  return <TrainerScheduleScreen />;
}
