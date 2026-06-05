import { LogOut, ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { logout } from "@/app/(merchant)/actions";
import { APP_CONFIG } from "@/lib/config/app-config";
import { getLateOrdersCountForAdmin } from "@/lib/data/platform";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();

  // Badge « commandes en retard » sur l'entrée Alertes.
  const lateCount = await getLateOrdersCountForAdmin();

  return (
    <div className="bg-surface-2 min-h-screen">
      <header className="border-border sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-white px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex shrink-0 items-center gap-2 font-semibold">
            <ShieldCheck className="text-primary-600 size-5" />
            <span className="hidden sm:inline">{APP_CONFIG.name} Admin</span>
          </span>
          <AdminNav lateCount={lateCount} />
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
      <main>{children}</main>
    </div>
  );
}
