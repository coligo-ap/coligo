import { Suspense } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { requireSuperAdmin, getAdminContext } from "@/lib/auth/admin";
import { logout } from "@/app/(merchant)/actions";
import { Logo } from "@/components/shared/logo";
import { AdminAlertsProvider } from "@/components/admin/admin-alerts-provider";
import { AlertFocusEffect } from "@/components/admin/alert-focus";
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
  // Contexte RBAC (owner/staff + domaines) → filtre la nav. Mémoïsé (React
  // cache) : réutilisé par les gates de chaque hub sans re-requêter.
  const { isOwner, domains } = await getAdminContext();

  return (
    <ConfirmProvider>
      <AdminAlertsProvider>
        {/* Surbrillance d'atterrissage des alertes (?focus=<code>). Suspense
            requis par useSearchParams ; ne rend rien. */}
        <Suspense fallback={null}>
          <AlertFocusEffect />
        </Suspense>
        {/* ZONES SÛRES Android/iOS (APK Capacitor edge-to-edge, viewport-fit=
            cover) : l'en-tête prolonge son fond SOUS la barre de statut
            (padding-top = inset), le contenu ne finit jamais DERRIÈRE la barre
            système du bas, et les insets latéraux couvrent le paysage. RÈGLE :
            calc(env() + x), jamais max(x, env()) — cf. CLAUDE.md. */}
        <div className="bg-surface-2 min-h-screen pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
          <header className="border-border sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-4 border-b bg-white px-4 pt-[env(safe-area-inset-top)] lg:px-6">
            <div className="flex min-w-0 items-center gap-3 lg:gap-4">
              <AdminMobileNav domains={domains} isOwner={isOwner} />
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
          <AdminShell domains={domains} isOwner={isOwner}>
            {/* Le bas de CHAQUE page admin reste au-dessus de la barre système. */}
            <main className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              {children}
            </main>
          </AdminShell>
        </div>
      </AdminAlertsProvider>
    </ConfirmProvider>
  );
}
