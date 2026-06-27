import { createClient } from "@/lib/supabase/server";
import { WALLET_ENTRY_META, type WalletEntryType } from "@/lib/types";
import {
  walletEntriesToCsv,
  type WalletCsvEntry,
} from "@/lib/finances/wallet-csv";

export const dynamic = "force-dynamic";

/** AAAA-MM (fuseau Alger) d'un ISO — pour filtrer un mois précis. */
function monthKeyAlgiers(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Africa/Algiers",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

type Row = {
  created_at: string;
  type: WalletEntryType;
  amount_da: number;
  note: string | null;
  orders: {
    order_number: string | null;
    payment_method: "cash" | "online";
  } | null;
};

/**
 * Export CSV du relevé commerçant (toutes les opérations, ou un mois via
 * ?month=AAAA-MM). RLS scope déjà au commerçant connecté. Format Excel FR/DZ.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("unauthorized", { status: 401 });
  }

  const month = new URL(request.url).searchParams.get("month");

  const { data } = await supabase
    .from("wallet_entries")
    .select(
      "created_at, type, amount_da, note, orders ( order_number, payment_method )"
    )
    .order("created_at", { ascending: false });

  let rows = (data ?? []) as unknown as Row[];
  if (month) rows = rows.filter((r) => monthKeyAlgiers(r.created_at) === month);

  const entries: WalletCsvEntry[] = rows.map((r) => ({
    created_at: r.created_at,
    type: r.type,
    order_number: r.orders?.order_number ?? null,
    payment_method: r.orders?.payment_method ?? null,
    amount_da: r.amount_da,
    note: r.note,
  }));

  const csv = walletEntriesToCsv(
    entries,
    (t) => WALLET_ENTRY_META[t as WalletEntryType]?.label ?? t
  );

  const filename = `coligo-releve${month ? `-${month}` : ""}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
