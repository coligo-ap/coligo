import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Gift, Sparkles } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { formatDA, cn } from "@/lib/utils";
import {
  getMyCashbackBalance,
  getMyCashbackHistory,
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

  const [balance, history] = await Promise.all([
    getMyCashbackBalance(),
    getMyCashbackHistory(100),
  ]);

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

        {/* Encart Coligo Pay à venir */}
        <section className="border-border bg-surface mt-4 flex items-start gap-3 rounded-[16px] border border-dashed p-4">
          <div className="bg-primary-50 text-primary-700 flex size-10 shrink-0 items-center justify-center rounded-full">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-semibold">
              Bientôt : <span className="text-primary-700">Coligo Pay</span>
            </p>
            <p className="text-muted mt-0.5 text-xs">
              Recharge ton compte par carte ou virement pour payer plus vite et
              gagner encore plus de cashback. Disponible avec l&apos;intégration
              du paiement en ligne.
            </p>
          </div>
          <Badge tone="primary">Bientôt</Badge>
        </section>

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

function describe(type: "cashback_earned" | "cashback_spent" | "adjustment") {
  switch (type) {
    case "cashback_earned":
      return { label: "Cashback gagné" };
    case "cashback_spent":
      return { label: "Cashback utilisé" };
    case "adjustment":
      return { label: "Ajustement" };
  }
}
