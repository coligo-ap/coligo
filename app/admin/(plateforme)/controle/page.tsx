import { createClient } from "@/lib/supabase/server";
import { getFeatureFlags, type FeatureKey } from "@/lib/data/feature-flags";
import { chargilyKeysPresence } from "@/lib/payments/chargily";
import { FeatureFlagCard } from "@/components/admin/feature-flags-form";
import { DispatchRadiiForm } from "@/components/admin/dispatch-radii-form";
import { ChargilyModeCard } from "@/components/admin/chargily-mode-card";
import { ColigoPayP2pCard } from "@/components/admin/coligo-pay-p2p-card";

export const dynamic = "force-dynamic";

// =============================================================================
// /admin/controle — la main du super-admin sur le front + l'API :
//   • Disponibilité des fonctionnalités (Drive, paiement en ligne, Coligo Pay,
//     cashback) : actif / masqué / bientôt / maintenance + message FR/AR.
//   • Rayons de dispatch (express + drive).
// =============================================================================

const FEATURE_META: { key: FeatureKey; label: string; hint: string }[] = [
  {
    key: "drive",
    label: "Coligo Drive (courses)",
    hint: "Le transport de personnes. Masqué/bientôt/maintenance retire l'onglet ou bloque les demandes de course.",
  },
  {
    key: "online_payment",
    label: "Paiement en ligne (carte)",
    hint: "Le paiement par carte (Chargily) au checkout. Bloqué = seuls les autres modes restent.",
  },
  {
    key: "coligo_pay",
    label: "Coligo Pay (QR + P2P)",
    hint: "Le wallet : paiement marchand QR et transferts Envoyer/Recevoir.",
  },
  {
    key: "cashback",
    label: "Cashback",
    hint: "Le gain et l'usage du cashback. Désactivé = plus de gain ni d'utilisation (sans casser les commandes).",
  },
  {
    key: "express",
    label: "Livraison express",
    hint: "Coupé = plus AUCUNE nouvelle commande express (refus au checkout) ni attribution aux livreurs. Les commandes déjà créées vont au bout.",
  },
  {
    key: "tour",
    label: "Livraison en tournée",
    hint: "Coupé = plus aucune nouvelle commande en tournée (refus au checkout). Les tournées déjà planifiées vont au bout.",
  },
];

export default async function AdminControlePage() {
  const supabase = await createClient();
  // Colonnes express/drive_dispatch_radius_km (mig 0182) pas encore typées.
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        c: string,
        v: boolean
      ) => {
        maybeSingle: () => Promise<{
          data: {
            express_dispatch_radius_km: number | string | null;
            drive_dispatch_radius_km: number | string | null;
            chargily_live_mode: boolean | null;
            p2p_enabled: boolean | null;
          } | null;
        }>;
      };
    };
  };
  const [flags, { data: settings }] = await Promise.all([
    getFeatureFlags(),
    from("platform_settings")
      .select(
        "express_dispatch_radius_km, drive_dispatch_radius_km, chargily_live_mode, p2p_enabled"
      )
      .eq("id", true)
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Contrôle des services
        </h1>
        <p className="text-muted mt-1 text-sm">
          Active, masque, met « bientôt » ou en maintenance chaque
          fonctionnalité — côté front <strong>et</strong> côté API (bloqué en
          base, jamais contournable).
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-foreground mb-3 text-sm font-semibold tracking-tight">
          Paiements en ligne — environnement
        </h2>
        <ChargilyModeCard
          live={settings?.chargily_live_mode === true}
          keys={chargilyKeysPresence()}
        />
      </section>

      <section
        data-alert-focus="services_maintenance"
        className="space-y-4 rounded-[16px]"
      >
        <h2 className="text-foreground text-sm font-semibold tracking-tight">
          Disponibilité des fonctionnalités
        </h2>
        {FEATURE_META.map((m) => (
          <FeatureFlagCard
            key={m.key}
            flag={flags[m.key]}
            label={m.label}
            hint={m.hint}
          />
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-foreground mb-3 text-sm font-semibold tracking-tight">
          Coligo Pay
        </h2>
        <ColigoPayP2pCard enabled={settings?.p2p_enabled === true} />
      </section>

      <section className="mt-8">
        <h2 className="text-foreground mb-3 text-sm font-semibold tracking-tight">
          Rayons de dispatch
        </h2>
        <DispatchRadiiForm
          express={Number(settings?.express_dispatch_radius_km ?? 6)}
          drive={Number(settings?.drive_dispatch_radius_km ?? 8)}
        />
      </section>
    </div>
  );
}
