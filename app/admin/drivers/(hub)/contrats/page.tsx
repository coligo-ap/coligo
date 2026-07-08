import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { LEGAL } from "@/lib/config/legal";
import type { PartnerContractRow } from "@/lib/types/partner-contract";
import { PartnerContractsManager } from "@/components/admin/partner-contracts-manager";

export const dynamic = "force-dynamic";

// Onglet « Contrats » du hub Livraison : contrats de partenariat livreur
// (prestataire indépendant), pendant du module commerçants. Gate domaine :
// layout du hub (requireAdminDomain("livraison")).
export default async function DriverContractsTab() {
  const supabase = await createClient();
  const canRead = await adminCan("livraison");
  const admin = canRead ? createAdminClient() : null;

  const [{ data: contracts }, driversRes, { data: platform }] =
    await Promise.all([
      supabase
        .from("partner_contracts" as never)
        .select(
          "id, contract_number, partner_kind, partner_id, status, party, terms, created_at, signed_at, signed_file_path, terminated_at, notes"
        )
        .eq("partner_kind", "driver")
        .order("created_at", { ascending: false }),
      admin
        ? admin
            .from("drivers" as never)
            .select("*")
            .order("full_name")
        : Promise.resolve({ data: [] }),
      supabase
        .from("platform_settings")
        .select(
          "driver_fee_rate, driver_float_cap_da, neg_threshold_driver_da" as never
        )
        .maybeSingle(),
    ]);
  // Colonnes récentes absentes de database.types.ts (types non régénérés).
  const ps = (platform ?? null) as Record<string, unknown> | null;

  const drivers = ((driversRes.data ?? []) as Record<string, unknown>[]).map(
    (d) => ({
      id: String(d.id),
      name: String(d.full_name ?? "—"),
      sub: [d.wilaya, d.phone].filter(Boolean).join(" · "),
      pending: d.is_verified !== true,
    })
  );

  return (
    <PartnerContractsManager
      kind="driver"
      contracts={(contracts ?? []) as unknown as PartnerContractRow[]}
      partners={drivers}
      defaults={{
        fee_pct: Math.round(Number(ps?.driver_fee_rate ?? 0.08) * 1000) / 10,
        float_cap_da: Number(ps?.driver_float_cap_da ?? 10000),
        debt_cap_da: Number(ps?.neg_threshold_driver_da ?? 5000),
        sign_place: LEGAL.address.split(",")[0] ?? "Akbou",
      }}
    />
  );
}
