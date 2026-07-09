import Link from "next/link";
import { MapPinned, Power } from "lucide-react";
import { ModulePaymentAccount } from "@/components/admin/module-payment-account";
import { NotifyOnVerifyToggle } from "@/components/admin/drivers/notify-on-verify-toggle";
import { getNotifyDriverOnVerify } from "@/app/admin/drivers/actions";

export const dynamic = "force-dynamic";

// Onglet « Paramètres & zones » du hub Livraison : notification d'activation des
// comptes livreurs, compte de versement plateforme affiché aux livreurs
// (recharge par virement) + raccourcis vers les réglages transverses (zones de
// service, rayon de dispatch express). Ces réglages restent la source unique
// côté Plateforme — ici, des deep-links.
export default async function DeliverySettingsTab() {
  const notifyOnVerify = await getNotifyDriverOnVerify();

  return (
    <div className="space-y-4">
      <NotifyOnVerifyToggle enabled={notifyOnVerify} />

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
