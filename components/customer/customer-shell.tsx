import { createClient } from "@/lib/supabase/server";
import { CustomerHeader } from "@/components/customer/customer-header";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { CustomerFooter } from "@/components/customer/customer-footer";
import { CartMonoProvider } from "@/components/customer/cart-mono-provider";
import { PushRegistrar } from "@/components/native/push-registrar";

/**
 * Chrome client : header (desktop + mobile), bottom-nav (mobile), footer (desktop).
 * Charge l'auth pour adapter le header (compte vs se-connecter) — pas de
 * blocage : la navigation est libre sans compte.
 *
 * `hideHeader` = true si une page porte elle-même sa navigation (zone +
 * compte + panier) et n'a pas besoin du header sticky du shell.
 */
export async function CustomerShell({
  children,
  hideHeader = false,
}: {
  children: React.ReactNode;
  hideHeader?: boolean;
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
      {!hideHeader && (
        <CustomerHeader isAuth={!!user} customerName={customerName} />
      )}
      <main className="pb-20 lg:pb-0">
        <CartMonoProvider>{children}</CartMonoProvider>
      </main>
      <CustomerFooter />
      <CustomerBottomNav />

      {/* Enregistrement du token FCM (no-op hors APK Capacitor, et n'agit
          que si l'utilisateur est connecté — sinon l'endpoint répondra 401
          et le registrar abandonne silencieusement). */}
      {user && <PushRegistrar role="customer" />}
    </div>
  );
}
