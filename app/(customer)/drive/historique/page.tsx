import { DriveHistoryLoader } from "@/components/customer/drive/drive-history";

/**
 * Page 100 % STATIQUE : AUCUN `await` serveur — même pas l'auth. Le prefetch du
 * `<Link>` couvre alors TOUT le segment et le tap ouvre l'écran INSTANTANÉMENT
 * (règle « passer d'une page à une autre = ultra rapide ») ; avant, la
 * navigation attendait l'aller-retour d'auth (jusqu'à plusieurs secondes à
 * froid, écran figé sur la barre de chargement).
 *
 * Sécurité inchangée : l'identité n'est utilisée ici QUE pour isoler le cache
 * par compte (résolue côté client depuis la session locale, zéro réseau) ; les
 * DONNÉES passent par l'action serveur `getDriveHistory`, qui se
 * ré-authentifie à chaque appel (session + RLS). Un visiteur non connecté est
 * renvoyé au login par le chargeur et ne peut rien lire.
 */
export default function DriveHistoriquePage() {
  return <DriveHistoryLoader />;
}
