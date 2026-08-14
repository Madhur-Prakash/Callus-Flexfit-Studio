import type { Metadata } from "next";
import { PlansScreen } from "@/features/plans/ui/plans-screen";

export const metadata: Metadata = { title: "Membership plans" };

export default function Page() {
  return <PlansScreen />;
}
