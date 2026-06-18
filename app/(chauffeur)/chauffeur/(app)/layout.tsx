import { DNav } from "@/components/chauffeur/d-ui";

/**
 * Coque PERSISTANTE des pages chauffeur authentifiées (Accueil, Drive, Gains,
 * Compte, Historique, Abonnement, Recharger). La barre `DNav` est montée UNE
 * fois ici → elle reste à l'écran pendant que le segment enfant se (re)streame,
 * et les `loading.tsx` n'affichent plus QUE le squelette du contenu (plus de
 * « loading global » qui redessinait nav + fond à chaque navigation).
 *
 * `DNav` est en `position: fixed` : sa place dans le DOM n'a pas d'importance,
 * on la rend après `{children}`. Les écrans hors coque (course, documents,
 * login, signup, telecharger) sont volontairement EN DEHORS de ce groupe et
 * n'ont donc pas de barre. Le gating (pending/gel/blocage) reste géré par
 * chaque page : ses états plein écran (`DWait`/`DFrozen`/`DBlocked`) recouvrent
 * la nav (overlays `fixed inset-0`).
 */
export default function ChauffeurAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <DNav />
    </>
  );
}
