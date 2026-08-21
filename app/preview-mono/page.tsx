import {
  MonoSection,
  MonoSectionLink,
} from "@/components/customer/mono/mono-section";
import { MonoCategoryRail } from "@/components/customer/mono/mono-category-rail";
import { MonoMerchantCard } from "@/components/customer/mono/mono-merchant-card";
import { MonoBottomNav } from "@/components/customer/mono/mono-bottom-nav";
import { MonoHeader } from "@/components/customer/mono/mono-header";
import { CATEGORIES, NEARBY, NEW_IN, PROMOS } from "./mock";

// =============================================================================
// /preview-mono — ÉCRAN DE VALIDATION du thème « bold minimalism ».
//
// La home client complète, rendue avec des données MOCKÉES : aucune requête,
// aucun hook métier, aucune session. Sert à trancher la direction artistique
// avant de brancher les vraies données.
//
// Tout est scopé par `data-theme-mono` : les tokens verts / crème n'existent
// qu'à l'intérieur de ce conteneur — la production (violet Coligo) n'est pas
// touchée.
// =============================================================================

export const metadata = {
  title: "Coligo — aperçu du thème mono",
  robots: { index: false, follow: false },
};

export default function PreviewMonoPage() {
  return (
    <div
      data-theme-mono
      className="min-h-screen bg-[var(--surface-page)] pb-[calc(112px+env(safe-area-inset-bottom))]"
    >
      <MonoHeader zone="Chéraga, Alger" cartCount={3} />

      {/* Rail de catégories : posé sur le FOND DE PAGE, pas dans un bloc — les
          objets détourés flottent, rien ne les encadre. */}
      <div className="px-4 pb-6">
        <MonoCategoryRail items={CATEGORIES} />
      </div>

      <div className="flex flex-col gap-4">
        <MonoSection
          tone="a"
          title="Autour de toi"
          subtitle="Les commerces les plus proches de Chéraga"
          action={<MonoSectionLink>Tout voir</MonoSectionLink>}
        >
          <div className="flex flex-col gap-4">
            {NEARBY.map((m) => (
              <MonoMerchantCard key={m.slug} merchant={m} />
            ))}
          </div>
        </MonoSection>

        <MonoSection
          tone="b"
          title="Promos du moment"
          subtitle="Offres actives aujourd'hui près de chez toi"
          action={<MonoSectionLink>Tout voir</MonoSectionLink>}
        >
          <div className="flex flex-col gap-4">
            {PROMOS.map((m) => (
              <MonoMerchantCard key={m.slug} merchant={m} />
            ))}
          </div>
        </MonoSection>

        <MonoSection
          tone="a"
          title="Nouveaux sur Coligo"
          action={<MonoSectionLink>Tout voir</MonoSectionLink>}
        >
          <div className="flex flex-col gap-4">
            {NEW_IN.map((m) => (
              <MonoMerchantCard key={m.slug} merchant={m} />
            ))}
          </div>
        </MonoSection>

        {/* Bloc crème de rappel : même grammaire, aucun séparateur. */}
        <MonoSection tone="b" title="Coligo Pay">
          <p className="text-title-sm font-normal text-[var(--ink-muted)]">
            Paie tes courses en un scan et récupère du cashback sur chaque
            commande.
          </p>
          <button
            type="button"
            className="text-body-lg mt-5 w-full rounded-[var(--radius-pill)] bg-[var(--ink)] py-4 font-bold text-[var(--surface-card)]"
          >
            Activer Coligo Pay
          </button>
        </MonoSection>
      </div>

      <MonoBottomNav active="home" counts={{ orders: 2 }} />
    </div>
  );
}
