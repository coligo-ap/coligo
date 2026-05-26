import { Logo } from "@/components/shared/logo";
import { DriverHeader } from "./driver-header";
import { DriverDrawer } from "./driver-drawer";

/**
 * Chrome unifié de l'espace livreur — header (logo + hamburger), drawer
 * (menu burger avec tous les écrans), footer minimal. Comportement
 * mobile-first car le livreur est sur mobile dans 99 % des cas.
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
    <div className="bg-surface-2 min-h-screen pb-20">
      <DriverHeader driverFirstName={driverFirstName} />
      <DriverDrawer driverFirstName={driverFirstName} />
      <main className="mx-auto max-w-md p-4">{children}</main>
      <footer className="text-subtle mx-auto mt-10 max-w-md px-4 pb-6 text-center text-xs">
        <Logo iconOnly variant="amber" size="sm" />
        <p className="mt-2">Coligo — Espace livreur</p>
      </footer>
    </div>
  );
}
