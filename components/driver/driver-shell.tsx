import { DriverBottomNav } from "./driver-bottom-nav";
import { PullToRefresh } from "./pull-to-refresh";

/**
 * Chrome des pages « consultables » de l'espace livreur, reproduit À
 * L'IDENTIQUE des maquettes (MAQUETTE-livreur-pages) : fond `--page`, zone de
 * contenu `.mq-content` (chaque page fournit son propre `.head` avec le titre),
 * barre d'onglets persistante. Pas de header custom ni de footer (artefacts
 * absents des maquettes).
 *
 * Pas d'auth ici : chaque page protégée appelle déjà `getCurrentDriver()`.
 */
export function DriverShell({
  children,
}: {
  children: React.ReactNode;
  /** Conservé pour compat d'appel ; non affiché (titre = .head de la page). */
  driverFirstName?: string;
}) {
  return (
    <div className="mq-screen min-h-[100dvh]">
      <PullToRefresh>
        <main className="mq-content mx-auto max-w-md">{children}</main>
      </PullToRefresh>
      <DriverBottomNav />
    </div>
  );
}
