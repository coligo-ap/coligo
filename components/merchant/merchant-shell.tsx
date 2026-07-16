import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { MerchantSidebar } from "@/components/merchant/desktop-sidebar";
import { MerchantTopbar } from "@/components/merchant/desktop-topbar";
import { MerchantMobileHeader } from "@/components/merchant/mobile-header";
import { MerchantMobileBottomNav } from "@/components/merchant/mobile-bottom-nav";
import { MobileDrawer } from "@/components/merchant/mobile-drawer";
import { InstallBanner } from "@/components/pwa/install-banner";
import { RouteRefreshOnFocus } from "@/components/shared/route-refresh-on-focus";
import { ConnectionGuard } from "@/components/shared/connection-guard";
import { OfflineDim } from "@/components/shared/offline-dim";
import { MerchantQueryProvider } from "@/components/merchant/merchant-query-provider";
import { ConfirmProvider } from "@/components/ui/confirm";
import { OrderRealtimeBridge } from "@/components/merchant/order-realtime-bridge";
import { PushRegistrar } from "@/components/native/push-registrar";
import { MerchantPendingScreen } from "@/components/merchant/merchant-pending-screen";
import { TawkChat } from "@/components/support/tawk-chat";
import { expireStalePendingOrders } from "@/lib/merchant/expire-pending";
import {
  DEFAULT_PRINT_SETTINGS,
  type AutoPrintMode,
  type PrintSettings,
  type PrintWidth,
} from "@/lib/types";

/**
 * Shell de l'espace commerçant : auth + lookup merchant + chrome (sidebar,
 * topbar, bottom-nav). Réutilisé par toutes les sections (/dashboard,
 * /catalog, /orders, …) via leur layout.tsx.
 */
export async function MerchantShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // PERF+BORNE : `getAuthUser()` (cache(), déjà bornée — lib/auth/session.ts)
  // au lieu d'un `auth.getUser()` propre à ce composant, monté par-dessus
  // CHAQUE page commerçant.
  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  type MerchantRow = {
    id: string;
    name: string;
    auto_accept_orders: boolean;
    auto_print: AutoPrintMode;
    print_copies: number;
    print_width: PrintWidth;
    orders_paused: boolean | null;
    paused_until: string | null;
    closure_start: string | null;
    closure_end: string | null;
    approval_status: "pending" | "approved" | "rejected" | null;
    rejected_reason: string | null;
  };
  // UNE seule requête `merchants` (fusion des colonnes shop + approbation) —
  // avant : deux SELECT séquentiels sur la MÊME ligne (même `eq(user_id)`),
  // ajoutant un aller-retour réseau complet à chaque page commerçant.
  // `approval_status`/`rejected_reason` hors types générés → requête castée.
  const merchantQuery = supabase.from.bind(supabase) as unknown as (
    t: string
  ) => {
    select: (c: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{
          data: MerchantRow | null;
          error: {
            code: string;
            message: string;
            details: string;
            hint: string;
          } | null;
        }>;
      };
    };
  };
  const { data: merchant, error } = await merchantQuery("merchants")
    .select(
      "id, name, auto_accept_orders, auto_print, print_copies, print_width, orders_paused, paused_until, closure_start, closure_end, approval_status, rejected_reason"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[merchant-shell] merchants query error:", {
      userId: user.id,
      email: user.email,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    redirect("/login?error=merchant_query_failed");
  }

  if (!merchant) {
    console.warn("[merchant-shell] no merchant row for user:", {
      userId: user.id,
      email: user.email,
    });
    redirect("/login?error=no_merchant");
  }

  // Validation obligatoire (mig 0273) : tant que le compte n'est pas approuvé,
  // on court-circuite TOUT l'espace commerçant (dashboard, orders, catalog…)
  // par un écran d'attente / refus.
  if (merchant.approval_status && merchant.approval_status !== "approved") {
    return (
      <MerchantPendingScreen
        status={merchant.approval_status}
        reason={merchant.rejected_reason ?? null}
        merchantName={merchant.name}
      />
    );
  }

  // Expiration paresseuse : refuse les commandes restées « à confirmer » plus
  // de 15 min. Rejouée à chaque accès commerçant (et via le refresh périodique
  // du pont Realtime) → robuste même sans la minuterie client. Sans cron, en
  // cohérence avec l'approche Express timing du projet.
  await expireStalePendingOrders(supabase);

  // Count pending pour notifs (après expiration → badge exact)
  const { count: pendingCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchant.id)
    .eq("status", "pending");

  // Verrous de pause / fermeture — partagés avec le bouton statut (header).
  const pauseInput = {
    orders_paused: merchant.orders_paused ?? false,
    paused_until: merchant.paused_until ?? null,
    closure_start: merchant.closure_start ?? null,
    closure_end: merchant.closure_end ?? null,
  };

  const printSettings: PrintSettings = merchant
    ? {
        auto_accept_orders: merchant.auto_accept_orders,
        auto_print: merchant.auto_print,
        print_copies: merchant.print_copies,
        print_width: merchant.print_width,
      }
    : DEFAULT_PRINT_SETTINGS;

  return (
    <MerchantQueryProvider>
      <ConfirmProvider>
        <div className="bg-surface-2 min-h-screen">
          {/* Refresh doux des données au retour au premier plan (complément du
          Router Cache : retour instantané puis maj asynchrone du RSC). */}
          <RouteRefreshOnFocus />
          {/* Garde de connexion PARTAGÉ (comme client/livreur/chauffeur) :
              bannière unique « hors ligne » + jamais de faux « en ligne ». */}
          <ConnectionGuard />
          {/* Desktop sidebar */}
          <MerchantSidebar merchantName={merchant.name} />

          {/* Mobile header */}
          <MerchantMobileHeader
            merchantName={merchant.name}
            pendingCount={pendingCount ?? 0}
            pauseInput={pauseInput}
          />

          {/* Main */}
          <div className="flex min-h-screen flex-col lg:pl-60">
            {/* Desktop topbar */}
            <MerchantTopbar
              userEmail={user.email ?? ""}
              merchantName={merchant.name}
              pendingCount={pendingCount ?? 0}
              pauseInput={pauseInput}
            />

            {/* Content — flouté hors ligne (contenu périmé), coque nette. */}
            <main className="flex-1 pb-20 lg:pb-0">
              <OfflineDim>{children}</OfflineDim>
            </main>
          </div>

          {/* Mobile bottom nav + drawer (le hamburger du header ouvre le drawer) */}
          <MerchantMobileBottomNav />
          <MobileDrawer merchantName={merchant.name} email={user.email ?? ""} />

          {/* Bandeau install PWA — auto-caché si déjà installée ou refusée < 14j */}
          <InstallBanner
            label="Installer l'application Commerçant"
            className="bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] lg:bottom-4"
          />

          {/* Pont Realtime + son + notif + overlay « Mode comptoir » — actif sur
          TOUTES les pages commerçant pour qu'aucune commande ne soit ratée,
          même si le commerçant est sur /orders, /catalog, /settings, etc.
          Le panneau de toggles « Alertes » est rendu en flottant sur les
          pages où il est pertinent (cf. la prop `usePathname` du bridge). */}
          <OrderRealtimeBridge
            merchantId={merchant.id}
            merchantName={merchant.name}
            printSettings={printSettings}
          />

          {/* Enregistrement du token FCM (no-op hors APK Capacitor). */}
          <PushRegistrar role="merchant" />

          {/* Live chat support (Tawk.to) — JAMAIS de bulle flottante : Tawk ne
          se charge QUE sur clic « Contacter le support » (openSupportChat).
          Ici on ne mémorise que le contexte (rôle/identité) pour l'agent. */}
          <TawkChat
            role="commercant"
            name={merchant.name}
            email={user.email ?? null}
            attributes={{
              Boutique: merchant.name,
              "ID commerçant": merchant.id,
            }}
          />
        </div>
      </ConfirmProvider>
    </MerchantQueryProvider>
  );
}
