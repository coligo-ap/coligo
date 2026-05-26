import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ReferralCodeCard } from "@/components/merchant/livreurs/referral-code-card";
import { DriversList } from "@/components/merchant/livreurs/drivers-list";

export const dynamic = "force-dynamic";

type LinkedDriver = {
  driver_id: string;
  full_name: string;
  phone: string;
  status: "pending" | "active" | "blocked";
  joined_at: string;
  status_changed_at: string;
};

export default async function MerchantDriversPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, name, slug, delivery_enabled, express_enabled, tours_enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!merchant) redirect("/login?error=no_merchant");

  // Code actif (s'il y en a un)
  const { data: activeCode } = await supabase
    .from("merchant_referral_codes")
    .select("id, is_active, expires_at, created_at")
    .eq("merchant_id", merchant.id)
    .eq("is_active", true)
    .maybeSingle();

  // Livreurs liés au commerçant — on JOIN drivers via FK (RLS autorise la
  // lecture via `drivers_select_via_merchant_drivers`).
  const { data: links } = await supabase
    .from("merchant_drivers")
    .select(
      "driver_id, status, joined_at, status_changed_at, drivers ( full_name, phone )"
    )
    .eq("merchant_id", merchant.id)
    .order("joined_at", { ascending: false });

  const drivers: LinkedDriver[] = (links ?? []).flatMap((row) => {
    // PostgREST renvoie l'embed comme objet OU tableau selon la cardinalité.
    const d = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
    if (!d) return [];
    return [
      {
        driver_id: row.driver_id,
        full_name: d.full_name,
        phone: d.phone,
        status: row.status as LinkedDriver["status"],
        joined_at: row.joined_at,
        status_changed_at: row.status_changed_at,
      },
    ];
  });

  const pending = drivers.filter((d) => d.status === "pending");
  const active = drivers.filter((d) => d.status === "active");
  const blocked = drivers.filter((d) => d.status === "blocked");

  const deliveryReady =
    merchant.delivery_enabled &&
    (merchant.express_enabled || merchant.tours_enabled);

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Mes livreurs
        </h1>
        <p className="text-muted mt-1 text-sm">
          Partage ton code à des livreurs pour qu&apos;ils rejoignent ta
          boutique. Tu valides chaque demande.
        </p>
      </header>

      {!deliveryReady && (
        <div className="border-warning-200 bg-warning-50 text-warning-700 mb-4 rounded-[12px] border px-4 py-3 text-sm">
          La livraison n&apos;est pas activée (ou aucun mode coché) — active-la
          dans{" "}
          <a className="underline" href="/settings">
            Paramètres → Livraison
          </a>{" "}
          avant de recruter des livreurs.
        </div>
      )}

      <div className="space-y-5">
        <ReferralCodeCard
          merchantSlug={merchant.slug}
          hasActiveCode={!!activeCode}
          expiresAt={activeCode?.expires_at ?? null}
          createdAt={activeCode?.created_at ?? null}
        />

        <DriversList
          title="Demandes en attente"
          icon={<Truck className="size-4" />}
          drivers={pending}
          variant="pending"
          emptyHint="Aucune demande pour le moment."
        />

        <DriversList
          title="Livreurs actifs"
          icon={<Truck className="size-4" />}
          drivers={active}
          variant="active"
          emptyHint="Aucun livreur actif."
        />

        {blocked.length > 0 && (
          <DriversList
            title="Bloqués"
            icon={<Truck className="size-4" />}
            drivers={blocked}
            variant="blocked"
            emptyHint=""
          />
        )}
      </div>
    </div>
  );
}
