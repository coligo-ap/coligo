import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DSubs } from "@/components/chauffeur/d-subs";
import { getCurrentChauffeur } from "@/lib/auth/chauffeur";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SubsHistory,
  SubsTabs,
  type SubsHistoryRow,
} from "@/components/partner/subs-ui";

export const dynamic = "force-dynamic";

/**
 * Abonnements chauffeur — style Bolt STRICT : un titre, deux sous-pages
 * (Offres · Historique), zéro texte marketing. Les avantages vivent SUR les
 * cartes d'offre (PriorityCard / PlanCard) — plus de héro ni d'onglet
 * « Avantages » qui répétaient la même information. Logique DSubs inchangée
 * (webhook seul fait foi).
 */

// Libellés de plans (local : d-ui est un module client, non importable ici
// pour de simples données). Les plans data-driven gardent leur code en repli.
const PLAN_LABEL: Record<string, string> = {
  free: "Gratuit",
  pro: "Pro",
  premium: "Premium",
};
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

export default async function ChauffeurAbonnementPage() {
  const ch = await getCurrentChauffeur();
  if (!ch) redirect("/chauffeur/login");
  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  // Lectures admin FILTRÉES sur ch.id (id de session) — même pattern que
  // getChauffeurFinances ; aucun paramètre client.
  const admin = createAdminClient();
  const [{ data: payments }, { data: passes }] = await Promise.all([
    admin
      .from("chauffeur_subscription_payments")
      .select("id, plan, amount_da, method, status, created_at")
      .eq("chauffeur_id", ch.id)
      .order("created_at", { ascending: false })
      .limit(24),
    // Cast non typé : `priority_subscriptions` (mig 0210) absente des types
    // générés — le filtre serveur sur ch.id reste la garde effective.
    (admin as unknown as SupabaseClient)
      .from("priority_subscriptions")
      .select(
        "id, status, period_start, period_end, amount_da, is_first_month, payment_method, created_at"
      )
      .eq("subject_type", "chauffeur")
      .eq("subject_id", ch.id)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const history: SubsHistoryRow[] = [
    ...(
      (payments ?? []) as {
        id: string;
        plan: string;
        amount_da: number;
        method: string;
        status: string;
        created_at: string;
      }[]
    ).map((p) => ({
      id: `plan-${p.id}`,
      title: isAr
        ? `اشتراك ${PLAN_LABEL[p.plan] ?? p.plan} · ${grp(p.amount_da)} دج`
        : `Abonnement ${PLAN_LABEL[p.plan] ?? p.plan} · ${grp(p.amount_da)} DA`,
      sub: `${fmtDate(p.created_at) ?? ""} · ${METHOD_LABEL[p.method] ?? p.method}`,
      status: p.status,
      when: p.created_at,
    })),
    ...(
      (passes ?? []) as {
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
      id: `pass-${s.id}`,
      title: isAr
        ? `البطاقة ذات الأولوية${s.is_first_month ? " · الشهر الأول" : ""} · ${grp(s.amount_da)} دج`
        : `Pass Prioritaire${s.is_first_month ? " · 1er mois" : ""} · ${grp(s.amount_da)} DA`,
      sub: `${
        s.period_start && s.period_end
          ? `${fmtDate(s.period_start)} → ${fmtDate(s.period_end)}`
          : (fmtDate(s.created_at) ?? "")
      } · ${METHOD_LABEL[s.payment_method] ?? s.payment_method}`,
      status: s.status,
      when: s.created_at,
    })),
  ]
    .sort((a, b) => (a.when < b.when ? 1 : -1))
    .map(({ when: _when, ...row }) => row);

  return (
    <div className="drive-jakarta pt-safe pb-safe-nav">
      {/* Titre sobre (style Bolt) — les cartes d'offre portent le discours. */}
      <div className="mx-auto max-w-[560px] px-4 pb-3">
        <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px] text-[var(--d-ink)]">
          {tr("Abonnement", "الاشتراك")}
        </h1>
      </div>

      <SubsTabs
        navClassName="mx-auto max-w-[560px] px-4"
        tabs={[
          {
            id: "offres",
            label: tr("Offres", "العروض"),
            // Prioritaire → Gratuit → plans + paiement — logique DSubs
            // inchangée. Suspense : requis par useSearchParams (?card=…).
            content: (
              <div className="mt-3">
                <Suspense fallback={null}>
                  <DSubs hideIntro />
                </Suspense>
              </div>
            ),
          },
          {
            id: "historique",
            label: tr("Historique", "السجل"),
            badge: history.length,
            content: (
              <div className="mx-auto mt-3 max-w-[560px] px-4">
                <SubsHistory
                  rows={history}
                  defaultOpen
                  emptyText={tr(
                    "Aucune opération pour l'instant.",
                    "لا عمليات حتى الآن."
                  )}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
