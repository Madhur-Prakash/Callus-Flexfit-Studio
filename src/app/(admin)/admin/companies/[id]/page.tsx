import type { Metadata } from "next";
import { CompanyDetailScreen } from "@/features/corporate/ui/company-detail-screen";

export const metadata: Metadata = { title: "Company" };

export default function Page() {
  return <CompanyDetailScreen />;
}
