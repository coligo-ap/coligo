"use client";

import { usePathname } from "next/navigation";
import { ClientThemeScope } from "@/components/customer/client-theme-scope";
import { RouteRefreshOnFocus } from "@/components/shared/route-refresh-on-focus";
import { CartMonoProvider } from "@/components/customer/cart-mono-provider";
import { CustomerHeader } from "@/components/customer/customer-header";
import { CustomerFooter } from "@/components/customer/customer-footer";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { PushRegistrar } from "@/components/native/push-registrar";
import { TawkChat } from "@/components/support/tawk-chat";

/**
 * Chrome CLIENT PERSISTANT — rendu UNE SEULE FOIS dans `(customer)/layout.tsx`.
 * Comme les layouts Next ne se re-rendent pas en naviguant entre pages d'un même
 * groupe, le header / la bottom-nav / le footer / les providers ne se
 * RE-MONTENT plus à chaque navigation (plus de « rechargement » de toute la
 * page, plus de re-fetch auth/flags par page) : seul le contenu (`children`)
 * change. C'est l'archi des grandes plateformes (chrome persistant).
 *
 * Le rendu du chrome dépend de la route (lu via usePathname, donc côté client
 * sans démonter la coque) — réplique EXACTE du comportement historique de
 * CustomerShell page par page :
 *  - bare      : plein écran / auth → aucun chrome (la page porte sa propre UI),
 *  - noHeader  : la page a sa propre topbar → nav + footer, sans header sticky,
 *  - full      : header + nav + footer (défaut marketplace).
 */
type Props = {
  children: React.ReactNode;
  isAuth: boolean;
  customerName: string | null;
  customerPhone: string | null;
  userEmail: string | null;
  userId: string | null;
  hiddenKeys: string[];
};

// Plein écran / auth : la page gère tout (souvent sa propre bottom-nav).
function isBare(p: string): boolean {
  return (
    p === "/se-connecter" ||
    p === "/inscription" ||
    p.startsWith("/course") ||
    p.startsWith("/drive") || // /drive + /drive/historique (nav propre)
    p.startsWith("/coligo-pay/qr") ||
    p.startsWith("/compte/infos") ||
    p.startsWith("/compte/telephone")
  );
}
// La page porte sa propre topbar (pas de header sticky), mais garde nav+footer.
function isNoHeader(p: string): boolean {
  return (
    p === "/compte" ||
    p.startsWith("/coligo-pay") || // portefeuille + sous-pages : topbar propre
    p.startsWith("/m/")
  );
}

export function CustomerChrome({
  children,
  isAuth,
  customerName,
  customerPhone,
  userEmail,
  userId,
  hiddenKeys,
}: Props) {
  const pathname = usePathname() || "/";
  const bare = isBare(pathname);
  const noHeader = bare || isNoHeader(pathname);

  return (
    <div data-space="client" className="bg-surface-2 min-h-screen">
      <ClientThemeScope />
      {/* Refresh doux des données au retour au premier plan. */}
      <RouteRefreshOnFocus />

      {!noHeader && (
        <CustomerHeader
          isAuth={isAuth}
          customerName={customerName}
          hiddenKeys={hiddenKeys}
        />
      )}

      {bare ? (
        <CartMonoProvider>{children}</CartMonoProvider>
      ) : (
        <main className="pb-20 lg:pb-0">
          <CartMonoProvider>{children}</CartMonoProvider>
        </main>
      )}

      {!bare && <CustomerFooter />}
      {!bare && <CustomerBottomNav hiddenKeys={hiddenKeys} />}

      {/* FCM (no-op hors APK / si non connecté). Monté une fois ici. */}
      {isAuth && <PushRegistrar role="customer" />}

      {/* Live chat support — JAMAIS de bulle flottante : Tawk ne se charge QUE
      sur clic « Contacter le support » (openSupportChat). Ici on ne mémorise
      que le contexte (rôle/identité) pour l'agent. */}
      <TawkChat
        role="client"
        name={customerName}
        email={userEmail}
        phone={customerPhone}
        attributes={{
          Compte: isAuth ? "Connecté" : "Visiteur",
          "ID client": userId ?? undefined,
        }}
      />
    </div>
  );
}
