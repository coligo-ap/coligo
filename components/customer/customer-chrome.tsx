"use client";

import { usePathname } from "next/navigation";
import { ClientThemeScope } from "@/components/customer/client-theme-scope";
import { RouteRefreshOnFocus } from "@/components/shared/route-refresh-on-focus";
import { SessionKeeper } from "@/components/shared/session-keeper";
import { CartMonoProvider } from "@/components/customer/cart-mono-provider";
import { CustomerHeader } from "@/components/customer/customer-header";
import { CustomerFooter } from "@/components/customer/customer-footer";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { ActiveOrdersBar } from "@/components/customer/active-orders-bar";
import { ConnectionGuard } from "@/components/shared/connection-guard";
import { OfflineDim } from "@/components/shared/offline-dim";
import { PushRegistrar } from "@/components/native/push-registrar";
import { AnnouncementHost } from "@/components/shared/announcement-host";
import { MarketingPush } from "@/components/native/marketing-push";
import { AppUrlListener } from "@/components/native/app-url-listener";
import { AppUpdateManager } from "@/components/native/app-update-manager";
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
  /** Thème « occasion » de l'accueil (mig 0415/0416) — null = header blanc. */
  homeTheme?: React.ComponentProps<typeof CustomerHeader>["homeTheme"];
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
    p.startsWith("/compte/telephone") ||
    p.startsWith("/compte/supprimer")
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
  homeTheme = null,
}: Props) {
  const pathname = usePathname() || "/";
  const bare = isBare(pathname);
  const noHeader = bare || isNoHeader(pathname);

  return (
    // Fond BLANC uniforme (style Bolt Food) sur TOUT l'espace client — les
    // cartes portent la hiérarchie par leurs BORDURES, plus par l'ombre.
    <div data-space="client" className="min-h-screen bg-white">
      <ClientThemeScope />
      {/* Refresh doux des données au retour au premier plan. */}
      <RouteRefreshOnFocus />
      {/* Session conservée au retour dans l'app (paiement externe, veille iOS). */}
      <SessionKeeper />
      {/* Garde de connexion : feedback + reprise auto quand le réseau coupe ou
          devient instable — jamais d'écran muet en session (cf. offline.html qui
          ne couvre QUE l'échec au cold start). */}
      <ConnectionGuard />

      {!noHeader && (
        <CustomerHeader
          isAuth={isAuth}
          customerName={customerName}
          hiddenKeys={hiddenKeys}
          homeTheme={homeTheme}
        />
      )}

      {bare ? (
        <CartMonoProvider>{children}</CartMonoProvider>
      ) : (
        /* RÈGLE safe-area : bas de page AU-DESSUS de la bottom-nav (+ inset
           système) + une ligne d'air — les derniers composants restent
           entièrement visibles et tapables sur tous les téléphones. */
        <main className="pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          {/* Hors ligne : le contenu (souvent périmé) est flouté/atténué mais
              reste là ; header + nav du bas + bandeau restent nets et
              utilisables. On ne fige jamais tout l'écran. */}
          <OfflineDim>
            <CartMonoProvider>{children}</CartMonoProvider>
          </OfflineDim>
        </main>
      )}

      {!bare && <CustomerFooter />}
      {/* Bandeau live « commandes en cours » — au-dessus de la bottom-nav,
          monté UNE FOIS dans la coque (persiste entre navigations). */}
      {!bare && isAuth && userId && <ActiveOrdersBar userId={userId} />}
      {!bare && <CustomerBottomNav hiddenKeys={hiddenKeys} />}

      {/* FCM (no-op hors APK / si non connecté). Monté une fois ici. */}
      {isAuth && <PushRegistrar role="customer" />}
      {/* Annonces admin (mig 0408) — pop-up ciblée, chargée après le paint. */}
      {isAuth && <AnnouncementHost role="customer" />}

      {/* Abonnement MARKETING géo (topic de la wilaya) — SANS condition d'auth :
          un client déconnecté continue de recevoir les promos de sa zone, alors
          que ses notifications PERSONNELLES sont coupées au logout. */}
      <MarketingPush />

      {/* App Links Android : un lien https://coligo.app/… tapé hors de l'app
          (e-mail, partage) route la SPA vers ce chemin. No-op hors APK. */}
      <AppUrlListener />

      {/* Google Play In-App Updates (flexible / immediate selon le minimum
          imposé côté serveur). No-op hors APK client installé depuis Play. */}
      <AppUpdateManager />

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
