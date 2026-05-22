import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MerchantSidebar } from "@/components/merchant/desktop-sidebar";
import { MerchantTopbar } from "@/components/merchant/desktop-topbar";
import { MerchantMobileHeader } from "@/components/merchant/mobile-header";
import { MerchantMobileBottomNav } from "@/components/merchant/mobile-bottom-nav";
import { MobileDrawer } from "@/components/merchant/mobile-drawer";

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
    .select("id, name")
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

  // Count pending pour notifs
  const { count: pendingCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchant.id)
    .eq("status", "pending");

  return (
    <div className="bg-surface-2 min-h-screen">
      {/* Desktop sidebar */}
      <MerchantSidebar merchantName={merchant.name} />

      {/* Mobile header */}
      <MerchantMobileHeader
        merchantName={merchant.name}
        pendingCount={pendingCount ?? 0}
      />

      {/* Main */}
      <div className="flex min-h-screen flex-col lg:pl-60">
        {/* Desktop topbar */}
        <MerchantTopbar
          userEmail={user.email ?? ""}
          merchantName={merchant.name}
          pendingCount={pendingCount ?? 0}
        />

        {/* Content */}
        <main className="flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav + drawer (le hamburger du header ouvre le drawer) */}
      <MerchantMobileBottomNav />
      <MobileDrawer merchantName={merchant.name} email={user.email ?? ""} />
    </div>
  );
}
