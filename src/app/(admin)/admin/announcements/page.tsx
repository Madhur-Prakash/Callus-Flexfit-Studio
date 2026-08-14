import type { Metadata } from "next";
import { AnnouncementsScreen } from "@/features/notifications/ui/announcements-screen";

export const metadata: Metadata = { title: "Announcements" };

export default function Page() {
  return <AnnouncementsScreen />;
}
