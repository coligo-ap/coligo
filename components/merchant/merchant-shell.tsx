import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MerchantSidebar } from "@/components/merchant/desktop-sidebar";
import { MerchantTopbar } from "@/components/merchant/desktop-topbar";
import { MerchantMobileHeader } from "@/components/merchant/mobile-header";
import { MerchantMobileBottomNav } from "@/components/merchant/mobile-bottom-nav";
import { MobileDrawer } from "@/components/merchant/mobile-drawer";
import { InstallBanner } from "@/components/pwa/install-banner";
import { RouteRefreshOnFocus } from "@/components/shared/route-refresh-on-focus";
import { MerchantQueryProvider } from "@/components/merchant/merchant-query-provider";
import { ConfirmProvider } from "@/components/ui/confirm";
import { OrderRealtimeBridge } from "@/components/merchant/order-realtime-bridge";
import { PushRegistrar } from "@/components/native/push-registrar";
import { MerchantPendingScreen } from "@/components/merchant/merchant-pending-screen";
import { TawkChat } from "@/components/support/tawk-chat";
import { expireStalePendingOrders } from "@/lib/merchant/expire-pending";
import {
  DEFAULT_PRINT_SETTINGS,
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: merchant, error } = await supabase
    .from("merchants")
    .select(
      "id, name, auto_accept_orders, auto_print, print_copies, print_width, orders_paused, paused_until, closure_start, closure_end"
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
  // on court-circuite TOUT l'espace commerçant (dashboard, orders, catalog…) par
  // un écran d'attente / refus. Colonnes hors types générés → requête castée.
  const approvalQuery = supabase.from.bind(supabase) as unknown as (
    t: string
  ) => {
    select: (c: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{
          data: {
            approval_status: "pending" | "approved" | "rejected" | null;
            rejected_reason: string | null;
          } | null;
        }>;
      };
    };
  };
  const { data: approval } = await approvalQuery("merchants")
    .select("approval_status, rejected_reason")
    .eq("user_id", user.id)
    .maybeSingle();
  if (approval?.approval_status && approval.approval_status !== "approved") {
    return (
      <MerchantPendingScreen
        status={approval.approval_status}
        reason={approval.rejected_reason ?? null}
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
        print_width: merchant.print_width as PrintWidth,
      }
    : DEFAULT_PRINT_SETTINGS;

  return (
    <MerchantQueryProvider>
      <ConfirmProvider>
        <div className="bg-surface-2 min-h-screen">
          {/* Refresh doux des données au retour au premier plan (complément du
          Router Cache : retour instantané puis maj asynchrone du RSC). */}
          <RouteRefreshOnFocus />
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

            {/* Content */}
            <main className="flex-1 pb-20 lg:pb-0">{children}</main>
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
