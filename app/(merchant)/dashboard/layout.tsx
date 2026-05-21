import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MerchantSidebar } from "@/components/merchant/desktop-sidebar";
import { MerchantTopbar } from "@/components/merchant/desktop-topbar";
import { MerchantMobileHeader } from "@/components/merchant/mobile-header";
import { MerchantMobileBottomNav } from "@/components/merchant/mobile-bottom-nav";

export default async function DashboardLayout({
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
    console.error("[dashboard] merchants query error:", {
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
    console.warn("[dashboard] no merchant row for user:", {
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
    <div className="min-h-screen bg-surface-2">
      {/* Desktop sidebar */}
      <MerchantSidebar merchantName={merchant.name} />

      {/* Mobile header */}
      <MerchantMobileHeader
        merchantName={merchant.name}
        pendingCount={pendingCount ?? 0}
      />

      {/* Main */}
      <div className="lg:pl-60 flex flex-col min-h-screen">
        {/* Desktop topbar */}
        <MerchantTopbar
          userEmail={user.email ?? ""}
          merchantName={merchant.name}
          pendingCount={pendingCount ?? 0}
        />

        {/* Content */}
        <main className="flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <MerchantMobileBottomNav />
    </div>
  );
}
