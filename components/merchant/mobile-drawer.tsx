"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Bug,
  Gift,
  HelpCircle,
  LayoutDashboard,
  Loader2,
  LogOut,
  ScanLine,
  Settings,
  Smartphone,
  Tag,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { logout } from "@/app/(merchant)/actions";
import { InstallButton } from "@/components/pwa/install-button";
import {
  mobileDrawer,
  useMobileDrawerOpen,
} from "@/components/merchant/use-mobile-drawer";

type DrawerItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
};

// Sections secondaires (celles retirées de la bottom-nav) + bientôt-disponibles.
const DRAWER_ITEMS: DrawerItem[] = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/encaisser", label: "Encaisser (QR)", icon: ScanLine },
  { href: "/promotions", label: "Promotions", icon: Tag },
  { href: "/fidelite", label: "Fidélité", icon: Gift },
  { href: "/livreurs", label: "Livreurs", icon: Truck },
  { href: "/livraison/creneaux", label: "Créneaux livraison", icon: Truck },
  { href: "/finances", label: "Finances", icon: Wallet },
  { href: "/settings", label: "Paramètres", icon: Settings },
  // Diag : accessible depuis le drawer car le WebView Capacitor n'a pas de
  // barre URL — sans ce lien, impossible d'atteindre la page de diagnostic.
  { href: "/dev/capacitor", label: "Diagnostic", icon: Bug },
];

export function MobileDrawer({
  merchantName,
  email,
}: {
  merchantName: string;
  email: string;
}) {
  const open = useMobileDrawerOpen();
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => mobileDrawer.close();

  // Animation slide-in fiable même sur WebView Android (Sunmi) :
  //   1. Quand `open` passe à true → on monte le DOM avec `translate-x-full`,
  //      puis on bascule à `translate-x-0` au rAF suivant → slide-in.
  //   2. Quand `open` passe à false → on remet `translate-x-full` (slide-out),
  //      puis après 200 ms on démonte complètement.
  //
  // Démonter du DOM en position fermée est CRUCIAL : sur certains WebView
  // (Sunmi inclus), un élément `fixed` même translaté hors-écran reste
  // hit-testable, ce qui rendait le drawer « collant » sur ces appareils.
  const [mounted, setMounted] = useState(false);
  const [slidIn, setSlidIn] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setSlidIn(true));
      return () => cancelAnimationFrame(id);
    }
    setSlidIn(false);
    const id = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(id);
  }, [open]);

  // Échap pour fermer, blocage du scroll de la page, focus sur le bouton X.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") mobileDrawer.close();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div className="lg:hidden">
      {/* Overlay sombre */}
      <div
        onClick={close}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
          slidIn ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Panneau coulissant — depuis la DROITE */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navigation"
        className={cn(
          // RÈGLE safe-area (APK edge-to-edge) : panneau `inset-y-0` → le FOND
          // blanc se prolonge sous la barre de statut, mais le CONTENU (en-tête,
          // bouton X) démarre dessous. Idem encoche latérale en paysage.
          "fixed inset-y-0 right-0 z-50 flex w-[82%] max-w-xs flex-col bg-white pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] shadow-xl transition-transform duration-200 ease-out",
          slidIn ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Identité du commerce */}
        <div className="border-border flex items-start justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo iconOnly variant="amber" size="md" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{merchantName}</p>
              {email && <p className="text-muted truncate text-xs">{email}</p>}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Fermer le menu"
            className="text-muted hover:bg-surface-2 hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation secondaire */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {DRAWER_ITEMS.map((item) => {
            const Icon = item.icon;

            if (item.disabled) {
              return (
                <div
                  key={item.href}
                  className="text-subtle rounded-control flex min-h-[44px] cursor-not-allowed items-center gap-3 px-3 py-2 text-sm"
                  title="Bientôt disponible"
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-subtle text-micro tracking-wider uppercase">
                    Bientôt
                  </span>
                </div>
              );
            }

            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={cn(
                  "rounded-control flex min-h-[44px] items-center gap-3 px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary-50 text-primary-900 font-medium"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                )}
              >
                <Icon className="size-5 shrink-0" />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}

          <Link
            href="/telecharger"
            onClick={close}
            className={cn(
              "rounded-control flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-sm transition-colors",
              pathname.startsWith("/telecharger")
                ? "bg-primary-50 text-primary-900 font-medium"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            <Smartphone className="size-5 shrink-0" />
            <span className="flex-1 text-left">Télécharger l’app</span>
          </Link>

          <Link
            href="/aide"
            onClick={close}
            className="text-muted hover:bg-surface-2 hover:text-foreground rounded-control flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-sm transition-colors"
          >
            <HelpCircle className="size-5 shrink-0" />
            <span className="flex-1 text-left">Aide &amp; support</span>
          </Link>

          <InstallButton variant="nav" onAfterPrompt={close} />
        </nav>

        <Separator />

        {/* Déconnexion (Server Action existante). RÈGLE safe-area : le panneau
            est fixed inset-y-0 → sans ce padding, le bouton passe DERRIÈRE la
            barre système du bas (gestes/boutons Android). calc(env()+x), jamais
            max() (max colle le bouton à la barre). */}
        <form
          action={logout}
          className="p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
        >
          <DrawerLogoutButton />
        </form>
      </aside>
    </div>
  );
}

function DrawerLogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 hover:border-danger-300 rounded-control flex min-h-[44px] w-full items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-5 shrink-0 animate-spin" />
      ) : (
        <LogOut className="size-5 shrink-0" />
      )}
      {pending ? "Déconnexion…" : "Déconnexion"}
    </button>
  );
}
