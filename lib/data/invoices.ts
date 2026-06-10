import { createClient } from "@/lib/supabase/server";
import type { WalletEntryType } from "@/lib/types";

/**
 * Factures / relevés MENSUELS du commerçant — agrégation simple des écritures
 * wallet par mois (fuseau Alger, fixe, pour éviter tout décalage de date).
 *
 * Objectif produit : un commerçant non « à l'aise avec les chiffres » télécharge
 * un récap clair par mois. Pas de calcul à faire : on additionne pour lui.
 */

export type InvoiceMonth = {
  /** Clé stable AAAA-MM (pour l'URL). */
  key: string;
  /** Libellé lisible « juin 2026 ». */
  label: string;
  /** Argent encaissé POUR le commerçant (ventes en ligne/QR + livraison tournée). */
  collectedForYou: number;
  /** Commission Coligo sur les produits (positif = part Coligo). */
  commission: number;
  /** Frais de service reversés à Coligo (cash). */
  serviceFees: number;
  /** Commission Coligo sur les livraisons de tournée. */
  tourCommission: number;
  /** Versements effectués vers le commerçant ce mois-ci. */
  payouts: number;
  /** Ajustements manuels (±). */
  adjustments: number;
  /** Mouvement NET du mois (somme de toutes les écritures). */
  net: number;
  /** Nombre de commandes distinctes concernées. */
  ordersCount: number;
};

const MONTH_FMT = new Intl.DateTimeFormat("fr-DZ", {
  month: "long",
  year: "numeric",
  timeZone: "Africa/Algiers",
});

/** AAAA-MM (fuseau Alger) à partir d'un ISO — déterministe serveur/navigateur. */
function monthKeyAlgiers(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Africa/Algiers",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return { key: `${year}-${month}`, label: MONTH_FMT.format(d) };
}

type Row = {
  amount_da: number;
  type: WalletEntryType;
  created_at: string;
  order_id: string | null;
};

function emptyMonth(key: string, label: string): InvoiceMonth {
  return {
    key,
    label,
    collectedForYou: 0,
    commission: 0,
    serviceFees: 0,
    tourCommission: 0,
    payouts: 0,
    adjustments: 0,
    net: 0,
    ordersCount: 0,
  };
}

function accumulate(m: InvoiceMonth, e: Row, orderSet: Set<string>) {
  m.net += e.amount_da;
  if (e.order_id) orderSet.add(e.order_id);
  switch (e.type) {
    case "sale":
    case "delivery_revenue":
    case "wallet_redemption":
      m.collectedForYou += e.amount_da;
      break;
    case "commission":
      m.commission += -e.amount_da;
      break;
    case "service_fee":
    case "service_fee_owed":
      m.serviceFees += -e.amount_da;
      break;
    case "tour_delivery_commission":
      m.tourCommission += -e.amount_da;
      break;
    case "payout":
      m.payouts += -e.amount_da;
      break;
    case "adjustment":
      m.adjustments += e.amount_da;
      break;
  }
}

/** Liste des mois ayant de l'activité, du plus récent au plus ancien. */
export async function getInvoiceMonths(): Promise<InvoiceMonth[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wallet_entries")
    .select("amount_da, type, created_at, order_id")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];

  const byMonth = new Map<string, { m: InvoiceMonth; orders: Set<string> }>();
  for (const e of rows) {
    const { key, label } = monthKeyAlgiers(e.created_at);
    let slot = byMonth.get(key);
    if (!slot) {
      slot = { m: emptyMonth(key, label), orders: new Set<string>() };
      byMonth.set(key, slot);
    }
    accumulate(slot.m, e, slot.orders);
  }
  const out: InvoiceMonth[] = [];
  for (const { m, orders } of byMonth.values()) {
    m.ordersCount = orders.size;
    out.push(m);
  }
  return out.sort((a, b) => (a.key < b.key ? 1 : -1));
}

export type Invoice = InvoiceMonth & {
  merchant: { name: string; city: string | null; address: string | null };
  generatedAtLabel: string;
};

/** Détail d'un mois précis (pour la facture imprimable). Null si pas d'activité. */
export async function getInvoice(monthKey: string): Promise<Invoice | null> {
  const months = await getInvoiceMonths();
  const m = months.find((x) => x.key === monthKey);
  if (!m) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: merchant } = user
    ? await supabase
        .from("merchants")
        .select("name, city, address")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  return {
    ...m,
    merchant: {
      name: merchant?.name ?? "Mon commerce",
      city: merchant?.city ?? null,
      address: merchant?.address ?? null,
    },
    generatedAtLabel: new Intl.DateTimeFormat("fr-DZ", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Africa/Algiers",
    }).format(new Date()),
  };
}
