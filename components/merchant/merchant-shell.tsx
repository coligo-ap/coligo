import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MerchantSidebar } from "@/components/merchant/desktop-sidebar";
import { MerchantTopbar } from "@/components/merchant/desktop-topbar";
import { MerchantMobileHeader } from "@/components/merchant/mobile-header";
import { MerchantMobileBottomNav } from "@/components/merchant/mobile-bottom-nav";
import { MobileDrawer } from "@/components/merchant/mobile-drawer";
import { InstallBanner } from "@/components/pwa/install-banner";
import { OrderRealtimeBridge } from "@/components/merchant/order-realtime-bridge";
import { PushRegistrar } from "@/components/native/push-registrar";
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
      "id, name, auto_accept_orders, auto_print, print_copies, print_width, orders_paused"
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

  const printSettings: PrintSettings = merchant
    ? {
        auto_accept_orders: merchant.auto_accept_orders,
        auto_print: merchant.auto_print,
        print_copies: merchant.print_copies,
        print_width: merchant.print_width as PrintWidth,
      }
    : DEFAULT_PRINT_SETTINGS;

  return (
    <div className="bg-surface-2 min-h-screen">
      {/* Desktop sidebar */}
      <MerchantSidebar merchantName={merchant.name} />

      {/* Mobile header */}
      <MerchantMobileHeader
        merchantName={merchant.name}
        pendingCount={pendingCount ?? 0}
        ordersPaused={merchant.orders_paused ?? false}
      />

      {/* Main */}
      <div className="flex min-h-screen flex-col lg:pl-60">
        {/* Desktop topbar */}
        <MerchantTopbar
          userEmail={user.email ?? ""}
          merchantName={merchant.name}
          pendingCount={pendingCount ?? 0}
          ordersPaused={merchant.orders_paused ?? false}
        />

        {/* Content */}
        <main className="flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav + drawer (le hamburger du header ouvre le drawer) */}
      <MerchantMobileBottomNav />
      <MobileDrawer merchantName={merchant.name} email={user.email ?? ""} />

      {/* Bandeau install PWA — auto-caché si déjà installée ou refusée < 14j */}
      <InstallBanner />

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
    </div>
  );
}
