import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PickupValidator } from "@/components/merchant/pickup-validator";

export const dynamic = "force-dynamic";

export default function ValidatePickupPage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-6">
        <Link
          href="/dashboard"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour aux commandes
        </Link>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Valider un retrait
        </h1>
        <p className="text-muted mt-1 text-sm">
          Confirmez la remise d&apos;une commande au client.
        </p>
      </header>

      <PickupValidator />
    </div>
  );
}
