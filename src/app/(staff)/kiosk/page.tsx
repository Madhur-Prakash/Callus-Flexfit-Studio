import type { Metadata } from "next";
import { KioskScreen } from "@/features/front-desk/ui/kiosk-screen";

export const metadata: Metadata = { title: "Check-in kiosk" };

export default function Page() {
  return <KioskScreen />;
}
