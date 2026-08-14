import Link from "next/link";
import { PageHeader } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Page not found"
        subtitle="That address doesn't match anything in the studio."
      />
      <div className="flex gap-3">
        <Link href="/schedule" className="btn btn-primary">
          View schedule
        </Link>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>
    </div>
  );
}
