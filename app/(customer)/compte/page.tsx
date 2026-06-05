import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronRight,
  Gift,
  Heart,
  MapPin,
  Receipt,
  Wallet,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { CustomerLogoutButton } from "@/components/customer/logout-button";
import { AccountEditor } from "@/components/customer/account-editor";
import {
  getMyCashbackBalance,
  getMyTopupBalance,
} from "@/lib/customer/cashback";
import { WILAYAS } from "@/lib/config/wilayas";
import { formatDA } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CustomerAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ complete?: string }>;
}) {
  const completePhone = (await searchParams).complete === "phone";
  const t = await getTranslations("account");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter");

  // Si c'est un commerçant connecté qui tape /compte par erreur → /dashboard.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  const { data: customer } = await supabase
    .from("customers")
    .select("full_name, phone, email, default_wilaya_code, default_commune")
    .eq("user_id", user.id)
    .maybeSingle();

  const wilayaName = customer?.default_wilaya_code
    ? WILAYAS.find((w) => w.code === customer.default_wilaya_code)?.name
    : null;

  const [cashbackBalance, topupBalance] = await Promise.all([
    getMyCashbackBalance(),
    getMyTopupBalance(),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 py-6 lg:px-6 lg:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            {t("myAccount")}
          </h1>
          <p className="text-muted mt-1 text-sm">{t("accountSubtitle")}</p>
        </header>

        {completePhone && !customer?.phone && (
          <div className="border-warning-200 bg-warning-50 text-warning-800 mb-4 rounded-[14px] border px-4 py-3 text-sm font-medium">
            {t.rich("completePhoneBanner", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
        )}

        {/* Raccourcis : Cashback / Coligo Pay / Commandes — chacun DISTINCT. */}
        <ul className="mb-4 space-y-2">
          <li>
            <Link
              href="/cashback"
              className="border-border bg-surface hover:border-primary-300 group flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
            >
              <div className="bg-primary-100 text-primary-700 flex size-11 shrink-0 items-center justify-center rounded-full">
                <Gift className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  {t("cashbackTitle")}
                </p>
                <p className="text-muted text-xs">
                  {t("cashbackDesc")} ·{" "}
                  <span className="text-primary-700 font-bold tabular-nums">
                    {formatDA(cashbackBalance)}
                  </span>
                </p>
              </div>
              <ChevronRight className="text-muted size-4" />
            </Link>
          </li>
          <li>
            <Link
              href="/coligo-pay"
              className="border-border bg-surface hover:border-primary-300 group flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
            >
              <div className="bg-primary-50 text-primary-700 flex size-11 shrink-0 items-center justify-center rounded-full">
                <Wallet className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  Coligo Pay
                </p>
                <p className="text-muted text-xs">
                  {t("coligoPayDesc")} ·{" "}
                  <span className="text-primary-700 font-bold tabular-nums">
                    {formatDA(topupBalance)}
                  </span>
                </p>
              </div>
              <ChevronRight className="text-muted size-4" />
            </Link>
          </li>
          <li>
            <Link
              href="/commandes"
              className="border-border bg-surface hover:border-primary-300 group flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
            >
              <div className="bg-primary-50 text-primary-700 flex size-11 shrink-0 items-center justify-center rounded-full">
                <Receipt className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  {t("myOrders")}
                </p>
                <p className="text-muted text-xs">{t("myOrdersDesc")}</p>
              </div>
              <ChevronRight className="text-muted size-4" />
            </Link>
          </li>
          <li>
            <Link
              href="/favoris"
              className="border-border bg-surface hover:border-primary-300 group flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
            >
              <div className="bg-coral-50 text-coral-600 flex size-11 shrink-0 items-center justify-center rounded-full">
                <Heart className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">
                  {t("myFavorites")}
                </p>
                <p className="text-muted text-xs">{t("myFavoritesDesc")}</p>
              </div>
              <ChevronRight className="text-muted size-4" />
            </Link>
          </li>
        </ul>

        {/* Informations éditables : nom + téléphone, et email avec code. */}
        <AccountEditor
          initialName={customer?.full_name ?? ""}
          initialPhone={customer?.phone ?? ""}
          initialEmail={user.email ?? customer?.email ?? ""}
        />

        {/* Adresses enregistrées (gérées sur leur page dédiée). */}
        <Link
          href="/adresses"
          className="border-border bg-surface hover:border-primary-300 mt-3 flex items-center gap-3 rounded-[14px] border p-4 transition-colors"
        >
          <div className="bg-primary-50 text-primary-700 flex size-11 shrink-0 items-center justify-center rounded-full">
            <MapPin className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-semibold">
              {t("myAddresses")}
            </p>
            <p className="text-muted text-xs">
              {wilayaName
                ? `${t("zone")} : ${wilayaName}${customer?.default_commune ? ` · ${customer.default_commune}` : ""}`
                : t("manageDeliveryAddresses")}
            </p>
          </div>
          <ChevronRight className="text-muted size-4" />
        </Link>

        <CustomerLogoutButton />
      </div>
    </CustomerShell>
  );
}
