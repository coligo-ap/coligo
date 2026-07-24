import { getFeatureFlags } from "@/lib/data/feature-flags";
import { GuestPayView } from "@/components/customer/shared-cart/guest-pay-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Payer la commande — Coligo",
  robots: { index: false },
};

/**
 * Page de paiement INVITÉ (publique, sans compte) — coligo.app/payer/{ptoken}.
 * L'invité règle la commande du capitaine (panier partagé) via Chargily
 * (Edahabia/CIB). Rassurante et minimale : nom du capitaine, commerçant,
 * montant — zéro jargon.
 */
export default async function GuestPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ ptoken: string }>;
  searchParams: Promise<{ st?: string }>;
}) {
  const { ptoken } = await params;
  const st = (await searchParams).st ?? null;
  const flags = await getFeatureFlags();

  return (
    <GuestPayView
      ptoken={ptoken}
      returnState={st === "success" || st === "failure" ? st : null}
      intlStatus={flags.intl_card.status}
    />
  );
}
