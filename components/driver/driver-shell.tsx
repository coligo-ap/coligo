import { DriverHeader } from "./driver-header";
import { DriverBottomNav } from "./driver-bottom-nav";
import { PullToRefresh } from "./pull-to-refresh";

/**
 * Chrome unifié de l'espace livreur (style Uber) — header (titre + refresh),
 * barre de navigation basse, fond gris #F2F2F2. Mobile-first. (Le drawer a été
 * retiré : la nav passe entièrement par la barre du bas.)
 *
 * Pas d'auth ici : chaque page protégée appelle déjà `getCurrentDriver()`.
 */
export function DriverShell({
  children,
  driverFirstName,
}: {
  children: React.ReactNode;
  driverFirstName?: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-[#f2f2f2] pb-16 text-[#0a0a0a]">
      <DriverHeader driverFirstName={driverFirstName} />
      <PullToRefresh>
        <main className="mx-auto max-w-md px-4 py-4">{children}</main>
      </PullToRefresh>
      <footer className="mx-auto max-w-md px-4 pb-6 text-center text-[11px] font-medium text-[#9e9e9e]">
        Coligo — Espace livreur
      </footer>
      <DriverBottomNav />
    </div>
  );
}
