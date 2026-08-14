import type { Metadata } from "next";
import { CompaniesScreen } from "@/features/corporate/ui/companies-screen";

export const metadata: Metadata = { title: "Corporate memberships" };

export default function Page() {
  return <CompaniesScreen />;
}
