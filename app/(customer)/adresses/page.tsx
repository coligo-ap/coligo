import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AddressesPanel } from "@/components/customer/addresses-panel";

export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter");

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) redirect("/se-connecter");

  const { data: addresses } = await supabase
    .from("customer_addresses")
    .select("id, label, lat, lng, address_text, phone_override, is_default")
    .eq("customer_id", customer.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Mes adresses</h1>
        <p className="text-muted mt-1 text-sm">
          Adresses utilisées pour les livraisons.
        </p>
      </header>
      <AddressesPanel addresses={addresses ?? []} />
    </div>
  );
}
