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
  SubsTabs,
  type SubsHistoryRow,
} from "@/components/partner/subs-ui";

export const dynamic = "force-dynamic";

/**
 * SOUS-PAGE « Abonnement & Pass » livreur — MÊMES composants que la page
 * chauffeur (subs-ui partagé), seules les DONNÉES changent : le livreur n'a
 * que le Pass Prioritaire (PriorityCard partagée). Découpé en SOUS-PAGES
 * (Pass · Avantages · Historique, style Bolt) : copy minimale, un seul sujet
 * à l'écran, panneaux montés en permanence.
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
        {/* Héro compact (copy minimale) partagé au-dessus des onglets. */}
        <SubsHero
          title="Passe devant, gagne plus."
          subtitle="Les courses proches, proposées en premier. Sans engagement."
        />

        <SubsTabs
          tabs={[
            {
              id: "pass",
              label: "Pass",
              // Souscription / statut / renouvellement (carte partagée).
              content: (
                <div className="mt-3">
                  <PriorityCard />
                </div>
              ),
            },
            {
              id: "avantages",
              label: "Avantages",
              content: (
                <div className="mt-3 space-y-3">
                  <BenefitsCarousel
                    items={[
                      {
                        icon: "zap",
                        title: "Proposé en premier",
                        text: "Les courses proches, avant les autres.",
                      },
                      {
                        icon: "badge",
                        title: "Badge Prioritaire",
                        text: "Visible par le client.",
                      },
                      {
                        icon: "shield",
                        title: "Zéro blocage",
                        text: "Jamais une course en moins.",
                      },
                      {
                        icon: "wallet",
                        title: "Activation immédiate",
                        text: "Coligo Pay ou carte.",
                      },
                    ]}
                  />
                  <PayMethodsRow />
                </div>
              ),
            },
            {
              id: "historique",
              label: "Historique",
              badge: history.length,
              content: (
                <div className="mt-3">
                  <SubsHistory
                    rows={history}
                    defaultOpen
                    emptyText="Aucune opération pour l'instant."
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
    </DriverShell>
  );
}
