import { DriverHeader } from "./driver-header";
import { DriverDrawer } from "./driver-drawer";
import { PullToRefresh } from "./pull-to-refresh";

/**
 * Chrome unifié de l'espace livreur (style Uber) — header (titre + hamburger),
 * drawer (menu burger avec tous les écrans), fond gris #F2F2F2. Mobile-first.
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
      <DriverDrawer driverFirstName={driverFirstName} />
      <PullToRefresh>
        <main className="mx-auto max-w-md px-4 py-4">{children}</main>
      </PullToRefresh>
      <footer className="mx-auto max-w-md px-4 pb-6 text-center text-[11px] font-medium text-[#9e9e9e]">
        Coligo — Espace livreur
      </footer>
    </div>
  );
}
