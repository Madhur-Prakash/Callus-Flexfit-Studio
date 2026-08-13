"use client";

import Link from "next/link";
import { useState } from "react";
import {
  EmptyRow,
  LoadingMessage,
  PageHeaderRow,
  PanelList,
  TintedBanner,
} from "@/components/ui";
import { CompanyForm } from "@/features/corporate/ui/company-form";
import { useTransientFlag } from "@/lib/hooks/use-transient";
import { trpc } from "@/lib/trpc/client";

export default function CompaniesPage() {
  const { data: companies, isLoading, refetch } = trpc.adminCompanies.list.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [created, markCreated] = useTransientFlag();

  const createMutation = trpc.adminCompanies.create.useMutation({
    onSuccess: () => {
      setShowForm(false);
      markCreated();
      refetch();
    },
  });

  if (isLoading) return <LoadingMessage />;

  return (
    <div className="space-y-6">
      <PageHeaderRow title="Corporate Memberships">
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn btn-sm">
            New Company
          </button>
        )}
      </PageHeaderRow>

      {created && (
        <TintedBanner tone="success">Company created successfully!</TintedBanner>
      )}

      {showForm && (
        <CompanyForm
          pending={createMutation.isPending}
          errorMessage={createMutation.error?.message}
          onCancel={() => setShowForm(false)}
          onSubmit={(company) => createMutation.mutate(company)}
        />
      )}

      <PanelList>
        {companies && companies.length > 0 ? (
          companies.map((company) => (
            <Link
              key={company.id}
              href={`/admin/companies/${company.id}`}
              className="flex items-center gap-4 p-4 hover:opacity-75 transition"
            >
              <div className="flex-1">
                <div className="font-medium">{company.name}</div>
                <div className="text-sm muted">{company.contactEmail}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{company.creditPoolBalance} credits</div>
                <div
                  className={`text-sm ${company.active ? "text-green-600" : "text-red-600"}`}
                >
                  {company.active ? "Active" : "Inactive"}
                </div>
              </div>
            </Link>
          ))
        ) : (
          <EmptyRow>No companies yet</EmptyRow>
        )}
      </PanelList>
    </div>
  );
}
