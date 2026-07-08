import { createClient } from "@/lib/supabase/server";
import { LEGAL } from "@/lib/config/legal";
import { getAllMerchantsForAdmin } from "@/lib/data/platform";
import type { MerchantContractRow } from "@/lib/types/merchant-contract";
import { ContractsManager } from "@/components/admin/merchants/contracts-manager";

export const dynamic = "force-dynamic";

// Onglet « Contrats » du hub Commerçants : émission du contrat de partenariat
// (droit algérien), pré-remplissage depuis un commerçant existant, PDF à faire
// signer (« lu et approuvé » + cachet, 2 exemplaires), archivage du scan signé
// et traçabilité complète (numéro unique, notes, résiliation).
// Gate domaine : layout du hub (requireAdminDomain("commercants")).
export default async function MerchantContractsTab() {
  const supabase = await createClient();

  const [{ data: contracts }, merchants, { data: platform }] =
    await Promise.all([
      supabase
        .from("merchant_contracts" as never)
        .select(
          "id, contract_number, merchant_id, status, party, terms, created_at, signed_at, signed_file_path, terminated_at, notes"
        )
        .order("created_at", { ascending: false }),
      getAllMerchantsForAdmin(),
      supabase
        .from("platform_settings")
        .select("commission_cash, commission_online, max_debt_da")
        .maybeSingle(),
    ]);

  const pct = (v: unknown) => Math.round(Number(v ?? 0) * 1000) / 10;

  return (
    <ContractsManager
      contracts={(contracts ?? []) as unknown as MerchantContractRow[]}
      merchants={merchants
        .sort((a, b) => a.name.localeCompare(b.name, "fr"))
        .map((m) => ({
          id: m.id,
          name: m.name,
          commune: m.city ?? "",
          pending: m.approval_status !== "approved",
        }))}
      defaults={{
        commission_cash_pct: pct(platform?.commission_cash),
        commission_online_pct: pct(platform?.commission_online),
        debt_cap_da: platform?.max_debt_da ?? 50000,
        sign_place: LEGAL.address.split(",")[0] ?? "Akbou",
      }}
    />
  );
}
