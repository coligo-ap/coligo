import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PriorityCard } from "@/components/partner/priority-card";
import { PartnerBackHeader } from "@/components/shared/partner-ui";
import {
  BenefitsCarousel,
  PayMethodsRow,
  SubsHero,
  SubsHistory,
  type SubsHistoryRow,
} from "@/components/partner/subs-ui";

export const dynamic = "force-dynamic";

/**
 * SOUS-PAGE « Abonnement & Pass » livreur — MÊMES composants que la page
 * chauffeur (subs-ui partagé : héro vendeur, carrousel d'avantages,
 * réassurance paiement, historique), seules les DONNÉES changent : le livreur
 * n'a que le Pass Prioritaire (géré par la PriorityCard partagée).
 */

const METHOD_LABEL: Record<string, string> = {
  wallet: "Coligo Pay",
  ccp: "CCP",
  card: "Carte",
};

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Algiers",
  });
}

export default async function DriverAbonnementPage() {
  // Fonctionnalité réservée aux comptes vérifiés par l'équipe Coligo :
  // un livreur en cours d'inscription est renvoyé à son étape du parcours.
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // Historique des souscriptions Pass (RLS owner_read + filtre explicite —
  // jamais compter sur la seule RLS). Cast non typé : table absente des types.
  const supabase = await createClient();
  const { data: subsRaw } = await (supabase as unknown as SupabaseClient)
    .from("priority_subscriptions")
    .select(
      "id, status, period_start, period_end, amount_da, is_first_month, payment_method, created_at"
    )
    .eq("subject_type", "driver")
    .eq("subject_id", driver.id)
    .order("created_at", { ascending: false })
    .limit(24);

  const history: SubsHistoryRow[] = (
    (subsRaw ?? []) as {
      id: string;
      status: string;
      period_start: string | null;
      period_end: string | null;
      amount_da: number;
      is_first_month: boolean;
      payment_method: string;
      created_at: string;
    }[]
  ).map((s) => ({
    id: s.id,
    title: `Pass Prioritaire${s.is_first_month ? " · 1er mois" : ""} · ${grp(s.amount_da)} DA`,
    sub: `${
      s.period_start && s.period_end
        ? `${fmtDate(s.period_start)} → ${fmtDate(s.period_end)}`
        : (fmtDate(s.created_at) ?? "")
    } · ${METHOD_LABEL[s.payment_method] ?? s.payment_method}`,
    status: s.status,
  }));

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <PartnerBackHeader href="/driver/parametres" title="Abonnement & Pass" />

      <div className="space-y-3">
        {/* Héro vendeur (composant partagé livreur/chauffeur). */}
        <SubsHero
          title="Passe devant, gagne plus."
          subtitle="Le Pass Prioritaire te propose les courses proches en premier — plus de courses, plus de gains, sans jamais te bloquer."
        />

        {/* Avantages en carrousel (scroll horizontal). */}
        <BenefitsCarousel
          items={[
            {
              icon: "zap",
              title: "Proposé en premier",
              text: "Les courses proches te sont proposées avant les autres livreurs.",
            },
            {
              icon: "badge",
              title: "Badge Prioritaire",
              text: "Visible par le client — inspire confiance et fidélise.",
            },
            {
              icon: "shield",
              title: "Zéro blocage",
              text: "La priorité accélère, elle ne t'enlève jamais une course.",
            },
            {
              icon: "wallet",
              title: "Activation immédiate",
              text: "Paie avec Coligo Pay ou ta carte — actif tout de suite.",
            },
          ]}
        />

        {/* Souscription / statut / renouvellement (carte partagée). */}
        <PriorityCard />

        {/* Réassurance moyens de paiement. */}
        <PayMethodsRow />

        {/* Historique unifié. */}
        <SubsHistory rows={history} />
      </div>
    </DriverShell>
  );
}
