import { LogOut, ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { logout } from "@/app/(merchant)/actions";
import { Logo } from "@/components/shared/logo";
import {
  getLateOrdersCountForAdmin,
  getPendingPayoutsCountForAdmin,
} from "@/lib/data/platform";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminShell } from "@/components/admin/admin-sidebar";
import { ConfirmProvider } from "@/components/ui/confirm";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();

  // Badges de nav : commandes en retard (Alertes) + versements à traiter.
  const [lateCount, payoutsCount] = await Promise.all([
    getLateOrdersCountForAdmin(),
    getPendingPayoutsCountForAdmin(),
  ]);

  return (
    <ConfirmProvider>
      <div className="bg-surface-2 min-h-screen">
        <header className="border-border sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-white px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3 lg:gap-4">
            <AdminMobileNav lateCount={lateCount} payoutsCount={payoutsCount} />
            <span className="flex shrink-0 items-center gap-2 font-semibold">
              <Logo size="sm" className="hidden sm:flex" />
              <ShieldCheck className="text-primary-600 size-5" />
              <span className="hidden sm:inline">Admin</span>
            </span>
          </div>
          <form action={logout} className="shrink-0">
            <button
              type="submit"
              className="text-danger-600 hover:bg-danger-50 inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-sm font-semibold transition-colors"
            >
              <LogOut className="size-3.5" />
              Déconnexion
            </button>
          </form>
        </header>
        {/* Drawer desktop (sidebar repliable) + contenu. Sur mobile la nav
          reste le drawer hamburger ci-dessus. */}
        <AdminShell lateCount={lateCount} payoutsCount={payoutsCount}>
          <main>{children}</main>
        </AdminShell>
      </div>
    </ConfirmProvider>
  );
}
