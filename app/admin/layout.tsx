import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { logout } from "@/app/(merchant)/actions";
import { APP_CONFIG } from "@/lib/config/app-config";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();

  return (
    <div className="bg-surface-2 min-h-screen">
      <header className="border-border sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white px-4 lg:px-6">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="text-primary-600 size-5" />
            {APP_CONFIG.name} Admin
          </span>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/admin/settings"
              className="text-muted hover:bg-surface-2 hover:text-foreground rounded-[10px] px-3 py-1.5 font-medium"
            >
              Taux
            </Link>
            <Link
              href="/admin/merchants"
              className="text-muted hover:bg-surface-2 hover:text-foreground rounded-[10px] px-3 py-1.5 font-medium"
            >
              Commerçants
            </Link>
            <Link
              href="/admin/security"
              className="text-muted hover:bg-surface-2 hover:text-foreground rounded-[10px] px-3 py-1.5 font-medium"
            >
              Sécurité
            </Link>
          </nav>
        </div>
        <form action={logout}>
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
