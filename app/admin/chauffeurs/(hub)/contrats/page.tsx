import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { LEGAL } from "@/lib/config/legal";
import type { PartnerContractRow } from "@/lib/types/partner-contract";
import { PartnerContractsManager } from "@/components/admin/partner-contracts-manager";

export const dynamic = "force-dynamic";

// Onglet « Contrats » du hub Coligo Drive : contrats de partenariat chauffeur
// (transport de personnes, prestataire indépendant). Gate domaine : layout du
// hub (requireAdminDomain("drive")).
export default async function ChauffeurContractsTab() {
  const supabase = await createClient();
  const canRead = await adminCan("drive");
  const admin = canRead ? createAdminClient() : null;

  const [{ data: contracts }, chauffeursRes, { data: platform }] =
    await Promise.all([
      supabase
        .from("partner_contracts" as never)
        .select(
          "id, contract_number, partner_kind, partner_id, status, party, terms, created_at, signed_at, signed_file_path, terminated_at, notes"
        )
        .eq("partner_kind", "chauffeur")
        .order("created_at", { ascending: false }),
      admin
        ? admin
            .from("chauffeurs" as never)
            .select("*")
            .order("full_name")
        : Promise.resolve({ data: [] }),
      supabase
        .from("platform_settings")
        .select("vtc_commission_rate, drive_freeze_debt_da")
        .maybeSingle(),
    ]);

  const chauffeurs = (
    (chauffeursRes.data ?? []) as Record<string, unknown>[]
  ).map((c) => ({
    id: String(c.id),
    name: String(c.full_name ?? "—"),
    sub: [c.wilaya ?? c.city, c.phone].filter(Boolean).join(" · "),
    pending: c.is_verified !== true,
  }));

  return (
    <PartnerContractsManager
      kind="chauffeur"
      contracts={(contracts ?? []) as unknown as PartnerContractRow[]}
      partners={chauffeurs}
      defaults={{
        fee_pct:
          Math.round(Number(platform?.vtc_commission_rate ?? 0.1) * 1000) / 10,
        float_cap_da: 0,
        debt_cap_da: Number(platform?.drive_freeze_debt_da ?? 3000),
        sign_place: LEGAL.address.split(",")[0] ?? "Akbou",
      }}
    />
  );
}
