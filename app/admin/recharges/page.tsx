import { createAdminClient } from "@/lib/supabase/admin";
import {
  RechargesManager,
  type PartnerRow,
  type PendingTopup,
} from "@/components/admin/recharges/recharges-manager";

export const dynamic = "force-dynamic";

// L'accès super-admin (+ MFA) est garanti par app/admin/layout.tsx.
export default async function AdminRechargesPage() {
  const admin = createAdminClient();
  const sel = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: unknown) => Promise<{ data: unknown }>;
          order: (
            c: string,
            o: { ascending: boolean }
          ) => Promise<{ data: unknown }>;
          in: (c: string, v: unknown[]) => Promise<{ data: unknown }>;
        };
      }
    )(t);

  const [flagRes, setRes, pendRes, partnersRes] = await Promise.all([
    sel("feature_flags").select("status").eq("key", "operator_gating"),
    sel("platform_settings")
      .select(
        "neg_threshold_driver_da, neg_threshold_chauffeur_da, neg_threshold_merchant_da, neg_threshold_new_days, operator_topup_max_da, operator_topup_presets_da"
      )
      .eq("id", true),
    sel("wallet_topup_requests")
      .select("id, wallet_id, method, amount_da, proof_url, created_at")
      .eq("status", "pending"),
    sel("operator_wallets")
      .select(
        "id, display_name, owner_name, registre_commerce, address, phone, hours, lat, lng, status, owner_type"
      )
      .eq("is_partner", true),
  ]);

  const flag = (flagRes.data as { status: string }[] | null)?.[0];
  const gatingActive = flag?.status === "active";

  const s = (
    setRes.data as
      | {
          neg_threshold_driver_da: number;
          neg_threshold_chauffeur_da: number;
          neg_threshold_merchant_da: number;
          neg_threshold_new_days: number;
          operator_topup_max_da: number;
          operator_topup_presets_da: number[] | null;
        }[]
      | null
  )?.[0];
  const thresholds = {
    driver: s?.neg_threshold_driver_da ?? 500,
    chauffeur: s?.neg_threshold_chauffeur_da ?? 500,
    merchant: s?.neg_threshold_merchant_da ?? 2000,
    newDays: s?.neg_threshold_new_days ?? 30,
    topupMax: s?.operator_topup_max_da ?? 100000,
    presets: s?.operator_topup_presets_da ?? [500, 1000, 2000, 5000],
  };

  const pendRaw =
    (pendRes.data as
      | {
          id: string;
          wallet_id: string;
          method: string;
          amount_da: number;
          proof_url: string;
          created_at: string;
        }[]
      | null) ?? [];

  const partnerRaw =
    (partnersRes.data as
      | {
          id: string;
          display_name: string | null;
          owner_name: string | null;
          registre_commerce: string | null;
          address: string | null;
          phone: string | null;
          hours: string | null;
          lat: number | null;
          lng: number | null;
          status: string;
          owner_type: string;
        }[]
      | null) ?? [];

  // Soldes des points partenaires (somme du grand livre) + leurs documents.
  const partnerIds = partnerRaw.map((p) => p.id);
  const balanceMap = new Map<string, number>();
  const docsMap = new Map<string, PartnerRow["docs"]>();
  if (partnerIds.length > 0) {
    const [{ data: entries }, { data: docs }] = await Promise.all([
      sel("operator_wallet_entries")
        .select("wallet_id, amount_da")
        .in("wallet_id", partnerIds),
      sel("partner_documents")
        .select("id, wallet_id, kind, url, label")
        .in("wallet_id", partnerIds),
    ]);
    for (const e of (entries as
      | { wallet_id: string; amount_da: number }[]
      | null) ?? []) {
      balanceMap.set(
        e.wallet_id,
        (balanceMap.get(e.wallet_id) ?? 0) + e.amount_da
      );
    }
    for (const d of (docs as
      | {
          id: string;
          wallet_id: string;
          kind: string;
          url: string;
          label: string | null;
        }[]
      | null) ?? []) {
      const arr = docsMap.get(d.wallet_id) ?? [];
      arr.push({ id: d.id, kind: d.kind, url: d.url, label: d.label });
      docsMap.set(d.wallet_id, arr);
    }
  }

  const partners: PartnerRow[] = partnerRaw.map((p) => ({
    walletId: p.id,
    displayName: p.display_name ?? "Agent Coligo Pay",
    ownerName: p.owner_name,
    registreCommerce: p.registre_commerce,
    address: p.address,
    phone: p.phone,
    hours: p.hours,
    lat: p.lat,
    lng: p.lng,
    status: p.status as PartnerRow["status"],
    balanceDa: balanceMap.get(p.id) ?? 0,
    docs: docsMap.get(p.id) ?? [],
  }));

  // Commerçants promouvables : ceux qui ont une position GPS (promotion idempotente).
  const { data: merchRaw } = await sel("merchants")
    .select("id, name, address, latitude, longitude")
    .order("name", { ascending: true });
  const promotableMerchants = (
    (merchRaw as
      | {
          id: string;
          name: string;
          address: string | null;
          latitude: number | null;
          longitude: number | null;
        }[]
      | null) ?? []
  )
    .filter((m) => m.latitude != null && m.longitude != null)
    .map((m) => ({ id: m.id, name: m.name, address: m.address }));

  // Libellé propriétaire des demandes en attente (nom si livreur/chauffeur/merchant).
  const ownerLabel = await resolveOwnerLabels(
    admin,
    pendRaw.map((r) => r.wallet_id)
  );
  const pending: PendingTopup[] = pendRaw.map((r) => ({
    id: r.id,
    walletId: r.wallet_id,
    ownerLabel: ownerLabel.get(r.wallet_id) ?? "Opérateur",
    method: r.method,
    amountDa: r.amount_da,
    proofUrl: r.proof_url,
    createdAt: r.created_at,
  }));

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Recharges & portefeuilles
        </h1>
        <p className="text-muted mt-1 text-sm">
          Enforcement, points de recharge, validation des recharges manuelles et
          seuils.
        </p>
      </header>
      <RechargesManager
        gatingActive={gatingActive}
        thresholds={thresholds}
        pending={pending}
        partners={partners}
        merchants={promotableMerchants}
      />
    </div>
  );
}

/** Construit un libellé lisible (nom) pour chaque portefeuille opérateur. */
async function resolveOwnerLabels(
  admin: ReturnType<typeof createAdminClient>,
  walletIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (walletIds.length === 0) return out;
  const q = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        select: (c: string) => {
          in: (c: string, v: unknown[]) => Promise<{ data: unknown }>;
        };
      }
    )(t);
  const { data: wallets } = await q("operator_wallets")
    .select("id, owner_type, owner_id, display_name")
    .in("id", walletIds);
  const rows =
    (wallets as
      | {
          id: string;
          owner_type: string;
          owner_id: string;
          display_name: string | null;
        }[]
      | null) ?? [];
  const byType: Record<string, { walletId: string; ownerId: string }[]> = {};
  for (const w of rows) {
    if (w.owner_type === "partner") {
      out.set(w.id, w.display_name ?? "Agent Coligo Pay");
    } else {
      (byType[w.owner_type] ??= []).push({
        walletId: w.id,
        ownerId: w.owner_id,
      });
    }
  }
  const tables: Record<string, string> = {
    driver: "drivers",
    chauffeur: "chauffeurs",
    merchant: "merchants",
  };
  for (const [type, list] of Object.entries(byType)) {
    const ids = list.map((x) => x.ownerId);
    const nameCol = type === "merchant" ? "name" : "full_name";
    const { data } = await q(tables[type])
      .select(`id, ${nameCol}`)
      .in("id", ids);
    const nameById = new Map(
      ((data as Record<string, string>[] | null) ?? []).map((r) => [
        r.id,
        r[nameCol],
      ])
    );
    for (const x of list) {
      out.set(x.walletId, nameById.get(x.ownerId) ?? "Opérateur");
    }
  }
  return out;
}
