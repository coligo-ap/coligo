import { createClient } from "@/lib/supabase/server";
import { CustomerHeader } from "@/components/customer/customer-header";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { CustomerFooter } from "@/components/customer/customer-footer";

/**
 * Chrome client : header (desktop + mobile), bottom-nav (mobile), footer (desktop).
 * Charge l'auth pour adapter le header (compte vs se-connecter) — pas de
 * blocage : la navigation est libre sans compte.
 */
export async function CustomerShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let customerName: string | null = null;
  if (user) {
    const { data: customer } = await supabase
      .from("customers")
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle();
    customerName = customer?.full_name ?? null;
  }

  return (
    <div className="bg-surface-2 min-h-screen">
      <CustomerHeader isAuth={!!user} customerName={customerName} />
      <main className="pb-20 lg:pb-0">{children}</main>
      <CustomerFooter />
      <CustomerBottomNav />
    </div>
  );
}
