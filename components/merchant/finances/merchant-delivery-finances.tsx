import { Banknote, CreditCard, Package, Truck } from "lucide-react";
import { formatDA } from "@/lib/utils";

/**
 * Section "Livraisons" sur la page /finances commerçant.
 * Affiche un récap des frais de livraison perçus + dettes côté livreurs.
 * Cachée si le commerçant n'a aucune commande livraison.
 */
export function MerchantDeliveryFinances({
  stats,
}: {
  stats: {
    totalDeliveryOrders: number;
    completedDeliveryOrders: number;
    cashDeliveryFeesDa: number;
    onlineDeliveryFeesDa: number;
    owedByDriversDa: number;
  };
}) {
  if (stats.totalDeliveryOrders === 0) return null;

  return (
    <section className="mx-auto mb-5 max-w-[1100px] space-y-3 px-4 pt-4 lg:px-6 lg:pt-6">
      <header className="flex items-center gap-2">
        <Truck className="size-5" />
        <h2 className="text-lg font-semibold tracking-tight">Livraisons</h2>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<Package className="size-4" />}
          label="Total livraisons"
          value={String(stats.totalDeliveryOrders)}
          sub={`${stats.completedDeliveryOrders} livrées`}
          tone="violet"
        />
        <Kpi
          icon={<CreditCard className="size-4" />}
          label="Frais livraison · en ligne"
          value={formatDA(stats.onlineDeliveryFeesDa)}
          sub="Encaissé via Chargily"
          tone="blue"
        />
        <Kpi
          icon={<Banknote className="size-4" />}
          label="Frais livraison · cash"
          value={formatDA(stats.cashDeliveryFeesDa)}
          sub="Perçu par le livreur"
          tone="green"
        />
        <Kpi
          icon={<Truck className="size-4" />}
          label="Dû par les livreurs"
          value={formatDA(stats.owedByDriversDa)}
          sub="Cash produits non reversé"
          tone="amber"
        />
      </div>

      <p className="text-subtle text-xs">
        💡 Les frais de livraison vont au livreur (modèle MVP). Le « dû par les
        livreurs » correspond au cash qu&apos;ils ont encaissé pour tes produits
        et doivent te reverser.
      </p>
    </section>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "violet" | "blue" | "green" | "amber";
}) {
  const colors: Record<typeof tone, string> = {
    violet: "bg-violet-50 text-violet-700",
    blue: "bg-primary-50 text-primary-700",
    green: "bg-success-50 text-success-700",
    amber: "bg-warning-50 text-warning-700",
  };
  return (
    <div className={"rounded-[12px] p-3 " + colors[tone]}>
      <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      <p className="text-xs opacity-70">{sub}</p>
    </div>
  );
}
