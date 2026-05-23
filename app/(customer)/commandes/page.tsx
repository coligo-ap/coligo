import Link from "next/link";
import { Receipt } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";

export const dynamic = "force-dynamic";

export default function CustomerOrdersPage() {
  return (
    <CustomerShell>
      <div className="mx-auto max-w-xl px-4 py-10 text-center lg:py-16">
        <Receipt className="text-primary-500 mx-auto size-12" />
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          Mes commandes
        </h1>
        <p className="text-muted mt-2 text-sm">
          L&apos;historique de tes commandes s&apos;affichera ici dès que tu
          auras passé ta première commande.
        </p>
        <Link
          href="/"
          className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex items-center justify-center rounded-[10px] px-4 py-2 text-sm font-medium text-white"
        >
          Découvrir les commerces
        </Link>
      </div>
    </CustomerShell>
  );
}
