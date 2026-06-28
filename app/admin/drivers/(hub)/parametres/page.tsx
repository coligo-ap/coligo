import Link from "next/link";
import { MapPinned, Power } from "lucide-react";
import { ModulePaymentAccount } from "@/components/admin/module-payment-account";

export const dynamic = "force-dynamic";

// Onglet « Paramètres & zones » du hub Livraison : compte de versement
// plateforme affiché aux livreurs (recharge par virement) + raccourcis vers les
// réglages transverses (zones de service, rayon de dispatch express). Ces
// réglages restent la source unique côté Plateforme — ici, des deep-links.
export default function DeliverySettingsTab() {
  return (
    <div className="space-y-4">
      <ModulePaymentAccount scope="driver" />

      <Link
        href="/admin/zones"
        className="border-border bg-surface hover:bg-surface-2 text-muted hover:text-foreground flex items-center gap-2 rounded-[12px] border px-4 py-3 text-sm font-medium transition-colors"
      >
        <MapPinned className="text-primary-500 size-4" />
        Zones de service (autoriser / bloquer la livraison par secteur) →
      </Link>
      <Link
        href="/admin/controle"
        className="border-border bg-surface hover:bg-surface-2 text-muted hover:text-foreground flex items-center gap-2 rounded-[12px] border px-4 py-3 text-sm font-medium transition-colors"
      >
        <Power className="text-primary-500 size-4" />
        Rayon de dispatch express &amp; disponibilité des services →
      </Link>
    </div>
  );
}
