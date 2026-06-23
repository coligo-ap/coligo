import { Suspense } from "react";
import { DNav } from "@/components/chauffeur/d-ui";
import { ChauffeurGateGuard } from "@/components/chauffeur/gate-guard";
import { HomeSkeleton } from "@/components/chauffeur/d-skeleton";
import { PushRegistrar } from "@/components/native/push-registrar";

/**
 * Coque PERSISTANTE des pages chauffeur authentifiées. Deux propriétés clés :
 *
 *  1. `DNav` est montée UNE fois (hors Suspense) → la barre du bas s'affiche
 *     INSTANTANÉMENT et reste à l'écran pendant tout chargement.
 *  2. Le gate (auth + statut) est résolu dans `ChauffeurGateGuard`, sous un
 *     `<Suspense>` : seul le CONTENU montre un squelette le temps de la 1ʳᵉ
 *     résolution. Comme un layout partagé ne se re-render pas entre ses enfants,
 *     la garde — et `getChauffeurGate()` — ne tourne QU'À la première entrée :
 *     les changements d'onglet n'ont plus d'aller-retour serveur → fin du
 *     « loading complet de chaque page ». Les pages lisent le gate via contexte.
 *
 * Écrans hors coque (course, documents, login, signup, telecharger) : hors de
 * ce groupe `(app)`, donc sans barre de nav.
 */
export default function ChauffeurAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense fallback={<HomeSkeleton />}>
        <ChauffeurGateGuard>{children}</ChauffeurGateGuard>
      </Suspense>
      <DNav />
      {/* Token push + branchement du TAP sur notification → navigation Next.js
          (data.route, ex. /chauffeur/demandes?ride=…). Monté ici (coque
          PERSISTANTE de TOUTES les pages authentifiées) et non dans l'accueil
          seul : sinon, taper une notification depuis la page Demandes — ou au
          démarrage à froid sur une autre page — n'attachait aucun listener et
          le tap « ne menait nulle part ». */}
      <PushRegistrar role="chauffeur" />
    </>
  );
}
