import { DriverBottomNav } from "./driver-bottom-nav";
import { PullToRefresh } from "./pull-to-refresh";
import { DriverContentDim } from "./driver-content-dim";

/**
 * Chrome des pages « consultables » de l'espace livreur — PARITÉ MAQUETTE
 * CHAUFFEUR : fond = surface (blanc en clair, sombre en dark), contenu
 * `px-5 pt-safe pb-safe-nav` (mêmes paddings que les pages chauffeur `drive-page`),
 * barre d'onglets persistante partagée.
 *
 * Pas d'auth ici : chaque page protégée appelle déjà `getCurrentDriver()`.
 */
export function DriverShell({
  children,
}: {
  children: React.ReactNode;
  /** Conservé pour compat d'appel ; non affiché (titre = h1 de la page). */
  driverFirstName?: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-surface)] text-[var(--d-ink)]">
      <PullToRefresh>
        <main className="pt-safe pb-safe-nav mx-auto max-w-md px-5">
          <DriverContentDim>{children}</DriverContentDim>
        </main>
      </PullToRefresh>
      <DriverBottomNav />
    </div>
  );
}
