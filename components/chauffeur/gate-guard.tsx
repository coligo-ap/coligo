import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { getFeatureFlag } from "@/lib/data/feature-flags";
import { idvBlocksAccess, idvRouteFor } from "@/lib/idv/compliance";
import { IdvRequiredScreen } from "@/components/idv/idv-required-screen";
import { DBlocked, DFrozen } from "@/components/chauffeur/d-gate";
import { ChauffeurLocationGate } from "@/components/chauffeur/chauffeur-location-gate";
import { ChauffeurGateProvider } from "./gate-context";

/**
 * Garde serveur de la coque chauffeur `(app)`. Résout le gate UNE fois (auth +
 * statut) puis :
 *  - pas de session       → redirige vers /chauffeur/login
 *  - compte bloqué/gelé   → écran plein écran (overlay), enfants non rendus
 *  - sinon                → expose le gate aux pages via le contexte client.
 *
 * Rendu DANS un `<Suspense>` de la coque : pendant la résolution du gate, la
 * barre de nav est déjà affichée et seul le contenu montre un squelette. Comme
 * la coque (layout) ne se re-render PAS entre les onglets, cette garde — et donc
 * `getChauffeurGate()` — ne tourne qu'à la 1ʳᵉ entrée, pas à chaque navigation.
 *
 * Les checks SPÉCIFIQUES à une page (dossier non soumis → /documents, non
 * vérifié → écran d'attente) restent dans chaque page, lus depuis le contexte.
 */
export async function ChauffeurGateGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  // PERF : les trois lectures sont INDÉPENDANTES (idvBlocksAccess n'a besoin
  // que du profil "chauffeur", pas du résultat du gate ; le drapeau vient de
  // la table feature_flags) — en parallèle plutôt qu'en cascade pour ne pas
  // empiler leurs allers-retours réseau.
  const [gate, idvBlocked, locationGateFlag] = await Promise.all([
    getChauffeurGate(),
    idvBlocksAccess("chauffeur"),
    // Vanne de sécurité /admin/controle (mig 0451) : autre que « active » =
    // la garde GPS n'est pas montée. Défaut actif (ligne absente comprise).
    getFeatureFlag("partner_location_gate"),
  ]);
  if (!gate) redirect("/chauffeur/login");
  if (gate.isBlocked) return <DBlocked />;
  if (gate.isFrozen) return <DFrozen reason={gate.frozenReason} />;
  // Vérification d'identité (IDV) OBLIGATOIRE et non confirmée → écran bloquant
  // RENDU (jamais un redirect : cf. lib/idv/compliance.ts, React #310 en prod).
  if (idvBlocked) {
    return (
      <IdvRequiredScreen route={idvRouteFor("chauffeur")} profile="chauffeur" />
    );
  }
  return (
    <ChauffeurGateProvider gate={gate}>
      {/* LOCALISATION OBLIGATOIRE — écran bloquant + mise hors ligne quand la
          position exacte manque. Monté ICI et pas dans la coque : un compte
          BLOQUÉ, GELÉ ou en attente d'IDV a déjà son propre écran, et on ne
          va pas lui réclamer son GPS par-dessus. Débrayable par le super-admin
          (/admin/controle, vanne de sécurité). */}
      {locationGateFlag.status === "active" && <ChauffeurLocationGate />}
      {children}
    </ChauffeurGateProvider>
  );
}
