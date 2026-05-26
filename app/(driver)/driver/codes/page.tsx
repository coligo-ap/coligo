import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DriverSubmitCodeForm } from "@/components/driver/submit-code-form";

export const dynamic = "force-dynamic";

export default function DriverSubmitCodePage() {
  return (
    <div className="space-y-6">
      <Link
        href="/driver"
        className="text-muted inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        Retour
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          Rejoindre un commerçant
        </h1>
        <p className="text-muted text-sm">
          Saisis le code de référence que le commerçant t&apos;a partagé.
        </p>
      </header>
      <DriverSubmitCodeForm />
    </div>
  );
}
