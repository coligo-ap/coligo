import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowDownLeft, ArrowUpRight, Gift } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import type { CustomerWalletEntry } from "@/lib/customer/cashback";

// =============================================================================
// EntryList — historique partagé entre /cashback et /coligo-pay.
// =============================================================================
// La page parent filtre déjà les entrées par `source` (cashback vs topup) ;
// ce composant se contente d'afficher proprement la liste.
// =============================================================================

type Props = {
  entries: CustomerWalletEntry[];
  emptyHint: string;
};

export async function WalletEntryList({ entries, emptyHint }: Props) {
  const t = await getTranslations("wallet");
  if (entries.length === 0) {
    return (
      <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-12 text-center text-sm">
        <Gift className="text-subtle mx-auto mb-2 size-6" />
        {t("noEntries")}
        <p className="mt-3">
          <Link
            href="/"
            className="text-primary-700 font-medium hover:underline"
          >
            {emptyHint} →
          </Link>
        </p>
      </div>
    );
  }
  return (
    <ul className="border-border bg-surface divide-border divide-y rounded-[16px] border">
      {entries.map((entry) => {
        const credit = entry.amount_da > 0;
        const meta = describe(entry.type, t);
        return (
          <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                credit
                  ? "bg-success-100 text-success-700"
                  : "bg-danger-50 text-danger-700"
              )}
            >
              {credit ? (
                <ArrowDownLeft className="size-5" />
              ) : (
                <ArrowUpRight className="size-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-semibold">
                {meta.label}
              </p>
              <p className="text-muted text-xs">
                {new Date(entry.created_at).toLocaleDateString("fr-DZ", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {entry.order_id && (
                  <>
                    {" · "}
                    <Link
                      href={`/commandes/${entry.order_id}`}
                      className="text-primary-700 hover:underline"
                    >
                      {t("viewOrder")}
                    </Link>
                  </>
                )}
              </p>
              {entry.note && (
                <p className="text-subtle mt-0.5 text-xs italic">
                  {entry.note}
                </p>
              )}
            </div>
            <span
              className={cn(
                "text-base font-bold tabular-nums",
                credit ? "text-success-700" : "text-danger-700"
              )}
            >
              {credit ? "+ " : "− "}
              {formatDA(Math.abs(entry.amount_da))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function describe(
  type: CustomerWalletEntry["type"],
  t: (key: string) => string
) {
  switch (type) {
    case "cashback_earned":
      return { label: t("entryCashbackEarned") };
    case "cashback_spent":
      return { label: t("entryCashbackSpent") };
    case "topup_credit":
      return { label: t("entryTopupCredit") };
    case "topup_spent":
      return { label: t("entryTopupSpent") };
    case "adjustment":
      return { label: t("entryAdjustment") };
  }
}
