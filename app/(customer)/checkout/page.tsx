import { redirect } from "next/navigation";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CheckoutView } from "@/components/customer/checkout-view";
import { createClient } from "@/lib/supabase/server";
import { getFeatureFlags } from "@/lib/data/feature-flags";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Auth obligatoire au checkout (PARTIE A) — sinon redirige vers /se-connecter
  // avec un retour vers /checkout après login.
  if (!user) {
    redirect("/se-connecter?next=/checkout");
  }

  // Si l'utilisateur connecté est un MARCHAND, pas un client → on l'arrête.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  const [{ data: customer }, flags] = await Promise.all([
    supabase
      .from("customers")
      .select("full_name, phone, latitude, longitude")
      .eq("user_id", user.id)
      .maybeSingle(),
    getFeatureFlags(),
  ]);

  return (
    <CustomerShell>
      <CheckoutView
        customer={{
          full_name: customer?.full_name ?? "",
          phone: customer?.phone ?? "",
          latitude: customer?.latitude ?? null,
          longitude: customer?.longitude ?? null,
        }}
        onlinePaymentStatus={flags.online_payment.status}
        coligoPayStatus={flags.coligo_pay.status}
        cashbackStatus={flags.cashback.status}
      />
    </CustomerShell>
  );
}
