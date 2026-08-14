import type { Metadata } from "next";
import { WaitlistScreen } from "@/features/bookings/ui/waitlist-screen";

export const metadata: Metadata = { title: "Waitlist" };

export default function Page() {
  return <WaitlistScreen />;
}
