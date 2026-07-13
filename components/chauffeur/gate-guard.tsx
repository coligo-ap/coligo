import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { requireIdvVerified } from "@/lib/idv/compliance";
import { DBlocked, DFrozen } from "@/components/chauffeur/d-gate";
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
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  if (gate.isBlocked) return <DBlocked />;
  if (gate.isFrozen) return <DFrozen reason={gate.frozenReason} />;
  // Vérification d'identité (IDV) : redirige vers le parcours UNIQUEMENT si le
  // super-admin l'a rendue obligatoire pour les chauffeurs et qu'elle n'est pas
  // encore confirmée. Sinon, aucun effet.
  await requireIdvVerified("chauffeur");
  return <ChauffeurGateProvider gate={gate}>{children}</ChauffeurGateProvider>;
}
