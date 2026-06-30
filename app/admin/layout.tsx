import { LogOut, ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { logout } from "@/app/(merchant)/actions";
import { Logo } from "@/components/shared/logo";
import { AdminAlertsProvider } from "@/components/admin/admin-alerts-provider";
import { AdminNotificationCenter } from "@/components/admin/admin-notification-center";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminShell } from "@/components/admin/admin-sidebar";
import { ConfirmProvider } from "@/components/ui/confirm";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // PERF : on ne fetch PAS les alertes au rendu serveur (ce serait un aller-retour
  // de plus sur le chemin critique de CHAQUE page admin). Le provider les charge
  // côté client juste après le montage (non bloquant) → la page s'affiche aussi
  // vite qu'avant, les badges apparaissent ~instantanément ensuite.
  await requireSuperAdmin();

  return (
    <ConfirmProvider>
      <AdminAlertsProvider>
        <div className="bg-surface-2 min-h-screen">
          <header className="border-border sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-white px-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-3 lg:gap-4">
              <AdminMobileNav />
              <span className="flex shrink-0 items-center gap-2 font-semibold">
                <Logo size="sm" className="hidden sm:flex" />
                <ShieldCheck className="text-primary-600 size-5" />
                <span className="hidden sm:inline">Admin</span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <AdminNotificationCenter />
              <form action={logout}>
                <button
                  type="submit"
                  className="text-danger-600 hover:bg-danger-50 inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-sm font-semibold transition-colors"
                >
                  <LogOut className="size-3.5" />
                  <span className="hidden sm:inline">Déconnexion</span>
                </button>
              </form>
            </div>
          </header>
          {/* Drawer desktop (sidebar repliable) + contenu. Sur mobile la nav
            reste le drawer hamburger ci-dessus. */}
          <AdminShell>
            <main>{children}</main>
          </AdminShell>
        </div>
      </AdminAlertsProvider>
    </ConfirmProvider>
  );
}
