import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Gift } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { ColigoPayCard } from "@/components/customer/coligo-pay-card";
import { createClient } from "@/lib/supabase/server";
import { formatDA, cn } from "@/lib/utils";
import {
  getMyCashbackBalance,
  getMyCashbackHistory,
  getMyTopupBalance,
  getTopupCreditedLast30dForCustomer,
} from "@/lib/customer/cashback";

export const dynamic = "force-dynamic";

export default async function CustomerCashbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/cashback");

  // Commerçant qui tape /cashback par erreur → renvoyé sur son dashboard.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("max_topup_da_per_30d")
    .eq("id", true)
    .maybeSingle();
  const maxPerRecharge = settings?.max_topup_da_per_30d ?? 50000;

  const [balance, topupBalance, credited30d, history] = await Promise.all([
    getMyCashbackBalance(),
    getMyTopupBalance(),
    customer
      ? getTopupCreditedLast30dForCustomer(customer.id)
      : Promise.resolve(0),
    getMyCashbackHistory(100),
  ]);
  const remaining30d = Math.max(0, maxPerRecharge - credited30d);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 py-6 pb-24 lg:px-6 lg:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Mon Cashback
          </h1>
          <p className="text-muted mt-1 text-sm">
            Gagnez du cashback à chaque commande, utilisez-le pour payer vos
            prochaines.
          </p>
        </header>

        {/* Solde principal */}
        <section className="from-primary-600 via-primary-700 to-primary-800 relative overflow-hidden rounded-[20px] bg-gradient-to-br p-6 text-white shadow-md">
          <Gift className="absolute -top-2 -right-2 size-28 text-white/10" />
          <p className="text-xs font-semibold tracking-wider text-white/85 uppercase">
            Solde disponible
          </p>
          <p className="mt-1 text-4xl leading-none font-bold tabular-nums lg:text-5xl">
            {formatDA(balance)}
          </p>
          <p className="text-primary-50/85 mt-3 max-w-md text-xs">
            Ce cashback est <strong>non retirable</strong>. Il se déduit
            automatiquement de tes prochaines commandes.
          </p>
        </section>

        {/* Coligo Pay — recharge réelle (Chargily) */}
        <ColigoPayCard
          balanceDa={topupBalance}
          remaining30d={remaining30d}
          maxPerRecharge={maxPerRecharge}
        />

        {/* Historique */}
        <section className="mt-6">
          <h2 className="text-foreground mb-3 text-base font-bold">
            Historique
          </h2>
          {history.length === 0 ? (
            <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-12 text-center text-sm">
              <Gift className="text-subtle mx-auto mb-2 size-6" />
              Aucune écriture pour le moment.
              <p className="mt-3">
                <Link
                  href="/"
                  className="text-primary-700 font-medium hover:underline"
                >
                  Découvrir les commerces →
                </Link>
              </p>
            </div>
          ) : (
            <ul className="border-border bg-surface divide-border divide-y rounded-[16px] border">
              {history.map((entry) => {
                const credit = entry.amount_da > 0;
                const meta = describe(entry.type);
                return (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
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
                        {new Date(entry.created_at).toLocaleDateString(
                          "fr-DZ",
                          {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                        {entry.order_id && (
                          <>
                            {" · "}
                            <Link
                              href={`/commandes/${entry.order_id}`}
                              className="text-primary-700 hover:underline"
                            >
                              Voir la commande
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
          )}
        </section>
      </div>
    </CustomerShell>
  );
}

function describe(
  type:
    | "cashback_earned"
    | "cashback_spent"
    | "adjustment"
    | "topup_credit"
    | "topup_spent"
) {
  switch (type) {
    case "cashback_earned":
      return { label: "Cashback gagné" };
    case "cashback_spent":
      return { label: "Cashback utilisé" };
    case "topup_credit":
      return { label: "Recharge Coligo Pay" };
    case "topup_spent":
      return { label: "Paiement par Coligo Pay" };
    case "adjustment":
      return { label: "Ajustement" };
  }
}
