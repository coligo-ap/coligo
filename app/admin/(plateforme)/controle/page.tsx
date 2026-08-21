import { createClient } from "@/lib/supabase/server";
import { getFeatureFlags, type FeatureKey } from "@/lib/data/feature-flags";
import { chargilyKeysPresence } from "@/lib/payments/chargily";
import { stripeKeysPresence } from "@/lib/payments/stripe";
import { FeatureFlagCard } from "@/components/admin/feature-flags-form";
import { DispatchRadiiForm } from "@/components/admin/dispatch-radii-form";
import { ChargilyModeCard } from "@/components/admin/chargily-mode-card";
import { StripeModeCard } from "@/components/admin/stripe-mode-card";
import { ColigoPayP2pCard } from "@/components/admin/coligo-pay-p2p-card";
import { AppThemeCard } from "@/components/admin/app-theme-card";
import { getAppTheme } from "@/lib/data/app-theme";

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
    key: "drive_interwilaya",
    label: "Drive — trajets Inter-wilayas",
    hint: "Les longs trajets entre wilayas (≥ 35 km, wilayas différentes). Masqué = onglet client retiré + sous-page chauffeur coupée ; bientôt/maintenance = grisé + demandes inter refusées (trigger DB). Les trajets en ville ne sont pas touchés.",
  },
  {
    key: "drive_carpool",
    label: "Drive — covoiturage par places",
    hint: "Départs inter-wilayas programmés par les chauffeurs, réservés à la place (PIN d'embarquement, Coligo Pay séquestré ou espèces). Coupé = plus de publication ni de réservation (trigger DB) ; les départs déjà réservés restent gérables. Coupé aussi automatiquement si Drive ou Inter-wilayas l'est.",
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
    key: "coligo_pay_agents",
    label: "Coligo Pay — réseau d'agents",
    hint: "Tout le domaine « Agent Coligo Pay » : autre que « active » = méthode « Espèces chez un agent » retirée des recharges (commerçant, livreur, chauffeur, abonnements), option agent retirée des portails partenaires et de /recrute, espace agent suspendu et inscriptions fermées. Le wallet Coligo Pay lui-même n'est pas touché (drapeau dédié ci-dessus).",
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
  {
    key: "barcode_marketplace",
    label: "Scan code-barres — accueil marketplace",
    hint: "Icône scan dans la recherche de l'accueil : le client scanne un produit → recherche chez tous les commerçants. Catalogue géré dans l'onglet Codes-barres.",
  },
  {
    key: "barcode_merchant",
    label: "Scan code-barres — fiche commerçant",
    hint: "Icône scan dans la recherche d'une boutique : le client scanne un produit → recherche dans le catalogue de CE commerçant.",
  },
  {
    key: "shared_cart",
    label: "Panier partagé",
    hint: "Panier collaboratif par lien WhatsApp (/p/…) : invités sans compte, commande finale sur le compte du capitaine. Masqué = bouton retiré + RPC invités coupées.",
  },
  {
    key: "intl_card",
    label: "Carte internationale (invité payeur)",
    hint: "Sélecteur Visa/Mastercard sur la page de paiement invité du panier partagé. « Bientôt » = affiché grisé ; s'activera quand la passerelle internationale sera branchée.",
  },
  {
    key: "wheel",
    label: "Roue Coligo (jeu quotidien)",
    hint: "Un tour par client et par jour : lots = bons d'achat crédités sur Coligo Pay, bonus de série. Lots et réglages dans Marketing → Roue. Masqué = page /roue retirée + tirages coupés.",
  },
  {
    key: "referral",
    label: "Parrainage client",
    hint: "Programme « Invite un ami » : lien /r/CODE, crédit Coligo Pay double à la 1ʳᵉ commande du filleul. Les montants et plafonds se règlent dans Marketing → Parrainage. Masqué = page client retirée + attributions gelées.",
  },
  {
    key: "loyalty",
    label: "Fidélité (cartes + cashback commerçant)",
    hint: "Programme de fidélité en magasin : cartes physiques + QR client, cashback et bons cloisonnés PAR commerçant (grand livre dédié, jamais l'argent plateforme). Autre que « active » = tout mouvement fidélité refusé (trigger DB), liaison de carte gelée, section client retirée. Les bornes se règlent dans Commerçants → Fidélité.",
  },
  {
    key: "identity_verification",
    label: "Vérification d'identité (IDV)",
    hint: "Kill-switch du parcours automatisé document + selfie (scan, liveness, comparaison du visage). Masqué = retiré partout. Les règles par profil et les seuils se pilotent dans Confiance → Identité.",
  },
  {
    key: "partner_location_gate",
    label: "Localisation obligatoire (chauffeurs + livreurs)",
    hint: "Vanne de SÉCURITÉ de la garde GPS : « active » = un chauffeur/livreur sans position exacte voit l'écran bloquant et passe hors ligne (comportement Uber/Bolt). Tout autre état = garde désactivée pour toute la flotte — à n'utiliser QUE si la garde bloque à tort (bug appareil, régression) le temps du correctif. Aucun écran « bientôt » : couper ne se voit pas, ça ne fait que lever le blocage.",
  },
  {
    key: "recruit_merchant",
    label: "Recrutement — commerçants (/recrute)",
    hint: "La carte « Devenir commerçant » de la page publique coligo.app/recrute. Masqué = carte retirée ; bientôt/maintenance = grisée sans lien. Le portail /signup lui-même n'est pas coupé (les dossiers restent validés par l'équipe).",
  },
  {
    key: "recruit_driver",
    label: "Recrutement — livreurs (/recrute)",
    hint: "La carte « Devenir livreur » de la page publique coligo.app/recrute. Masqué = carte retirée ; bientôt/maintenance = grisée sans lien vers /driver/signup.",
  },
  {
    key: "recruit_chauffeur",
    label: "Recrutement — chauffeurs (/recrute)",
    hint: "La carte « Devenir chauffeur » de la page publique coligo.app/recrute. Masqué = carte retirée ; bientôt/maintenance = grisée sans lien vers /chauffeur/signup.",
  },
  {
    key: "recruit_agent",
    label: "Recrutement — agents Coligo Pay (/recrute)",
    hint: "La carte « Devenir agent » de la page publique coligo.app/recrute. Masqué = carte retirée ; bientôt/maintenance = grisée sans lien vers /partenaire/signup.",
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
            stripe_live_mode: boolean | null;
            p2p_enabled: boolean | null;
          } | null;
        }>;
      };
    };
  };
  const [flags, { data: settings }, appTheme] = await Promise.all([
    getFeatureFlags(),
    from("platform_settings")
      .select(
        "express_dispatch_radius_km, drive_dispatch_radius_km, chargily_live_mode, stripe_live_mode, p2p_enabled"
      )
      .eq("id", true)
      .maybeSingle(),
    getAppTheme(),
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
          Apparence — thème des occasions
        </h2>
        <AppThemeCard
          current={appTheme.theme}
          currentModel={appTheme.model}
          marketplaceHero={appTheme.marketplaceHero}
          heroCategories={appTheme.heroCategories}
        />
      </section>

      <section className="mb-8">
        <h2 className="text-foreground mb-3 text-sm font-semibold tracking-tight">
          Paiements en ligne — environnement
        </h2>
        <ChargilyModeCard
          live={settings?.chargily_live_mode === true}
          keys={chargilyKeysPresence()}
        />
        <div className="mt-3">
          <StripeModeCard
            live={settings?.stripe_live_mode === true}
            keys={stripeKeysPresence()}
          />
        </div>
      </section>

      <section
        data-alert-focus="services_maintenance"
        className="space-y-4 rounded-lg"
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
