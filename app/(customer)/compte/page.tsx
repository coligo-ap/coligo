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
      <div className="mx-auto max-w-2xl px-4 pb-24 lg:px-6">
        {/* HERO plein-cadre : identité + les 2 soldes côte à côte (Cashback /
            Coligo Pay) → fusionne l'en-tête et les 2 cartes solde en un bandeau. */}
        <section className="from-primary-600 to-primary-800 relative -mx-4 bg-gradient-to-br px-4 pt-6 pb-5 text-white lg:-mx-6 lg:px-6 lg:pt-8">
          <p className="text-xs font-semibold tracking-wider text-white/80 uppercase">
            {t("myAccount")}
          </p>
          {customer?.full_name && (
            <p className="mt-0.5 text-xl leading-tight font-bold">
              {customer.full_name}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              href="/cashback"
              className="rounded-2xl bg-white/15 p-3 backdrop-blur transition-colors hover:bg-white/25"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
                <Gift className="size-3.5" />
                {t("cashbackTitle")}
              </span>
              <p className="mt-1 text-lg leading-none font-bold tabular-nums">
                {formatDA(cashbackBalance)}
              </p>
            </Link>
            <Link
              href="/coligo-pay"
              className="rounded-2xl bg-white/15 p-3 backdrop-blur transition-colors hover:bg-white/25"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
                <Wallet className="size-3.5" />
                Coligo Pay
              </span>
              <p className="mt-1 text-lg leading-none font-bold tabular-nums">
                {formatDA(topupBalance)}
              </p>
            </Link>
          </div>
        </section>

        {completePhone && !customer?.phone && (
          <div className="border-warning-200 bg-warning-50 text-warning-800 mt-4 rounded-[14px] border px-4 py-3 text-sm font-medium">
            {t.rich("completePhoneBanner", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
        )}

        {/* Raccourcis Commandes / Favoris — grille 2 colonnes compacte. */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href="/commandes"
            className="border-border bg-surface hover:border-primary-300 flex items-center gap-2.5 rounded-[14px] border p-3 transition-colors"
          >
            <div className="bg-primary-50 text-primary-700 flex size-10 shrink-0 items-center justify-center rounded-full">
              <Receipt className="size-5" />
            </div>
            <span className="text-foreground min-w-0 text-sm font-semibold">
              {t("myOrders")}
            </span>
          </Link>
          <Link
            href="/favoris"
            className="border-border bg-surface hover:border-primary-300 flex items-center gap-2.5 rounded-[14px] border p-3 transition-colors"
          >
            <div className="bg-coral-50 text-coral-600 flex size-10 shrink-0 items-center justify-center rounded-full">
              <Heart className="size-5" />
            </div>
            <span className="text-foreground min-w-0 text-sm font-semibold">
              {t("myFavorites")}
            </span>
          </Link>
        </div>

        {/* Informations éditables : nom + téléphone, et email avec code. */}
        <div className="mt-4">
          <AccountEditor
            initialName={customer?.full_name ?? ""}
            initialPhone={customer?.phone ?? ""}
            initialEmail={user.email ?? customer?.email ?? ""}
          />
        </div>

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
          <ChevronRight className="text-muted size-4 rtl:-scale-x-100" />
        </Link>

        <CustomerLogoutButton />
      </div>
    </CustomerShell>
  );
}
