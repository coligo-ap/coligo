import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  ChevronRight,
  Gift,
  Heart,
  MapPin,
  Phone,
  Receipt,
  Settings,
  Ticket,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { CustomerLogoutButton } from "@/components/customer/logout-button";
import { CustomerLanguageRow } from "@/components/customer/customer-language-row";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import { CustomerSupportRow } from "@/components/support/customer-support-row";
import { WalletBalanceValue } from "@/components/customer/wallet/balance-value";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import {
  getMyCashbackBalance,
  getMyTopupBalance,
} from "@/lib/customer/cashback";
import { WILAYAS } from "@/lib/config/wilayas";
import { AppVersionLabel } from "@/components/customer/app-version-label";

export const dynamic = "force-dynamic";

/**
 * Nombre de commandes EN COURS (tout sauf récupérée/annulée), en ne comptant
 * que les commandes visibles (cash, ou online payée — cf. /commandes). Isolé en
 * helper pour être lancé EN PARALLÈLE des soldes/flags dans le RSC.
 */
async function countOngoingOrders(customerId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .not("status", "in", "(completed,cancelled)")
    .or(
      "payment_method.eq.cash,and(payment_method.eq.online,payment_status.eq.paid)"
    );
  return count ?? 0;
}

export default async function CustomerAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ complete?: string }>;
}) {
  const completePhone = (await searchParams).complete === "phone";
  const t = await getTranslations("account");
  // Session + profil mémoïsés (partagés avec le layout → pas de double auth).
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter");

  const customer = await getCurrentCustomerFull();

  // RSC ALLÉGÉ : garde commerçant, flags, soldes ET compteur de commandes en
  // cours sont résolus EN PARALLÈLE (un seul lot) au lieu d'une cascade
  // séquentielle (auth → merchant → customer → count → soldes) → /compte
  // s'ouvre nettement plus vite et ne « recharge » plus à chaque navigation.
  const [merchant, flags, cashbackBalance, topupBalance, ongoingCount] =
    await Promise.all([
      getCurrentMerchant(),
      getFeatureFlags(),
      getMyCashbackBalance(),
      getMyTopupBalance(),
      customer ? countOngoingOrders(customer.id) : Promise.resolve(0),
    ]);
  // Si c'est un commerçant connecté qui tape /compte par erreur → /dashboard.
  if (merchant) redirect("/dashboard");

  const wilayaName = customer?.default_wilaya_code
    ? WILAYAS.find((w) => w.code === customer.default_wilaya_code)?.name
    : null;
  // Disponibilité des poches (super-admin). 'hidden' = carte retirée ;
  // 'coming_soon'/'maintenance' = carte grisée non cliquable.
  const cashbackVisible = flags.cashback.status !== "hidden";
  const cashbackActive = flags.cashback.status === "active";
  const payVisible = flags.coligo_pay.status !== "hidden";
  const payActive = flags.coligo_pay.status === "active";
  const visibleCount = (cashbackVisible ? 1 : 0) + (payVisible ? 1 : 0);
  const disabledLabel = (s: string) =>
    s === "coming_soon" ? "Bientôt" : "Indisponible";

  // « Compte vérifié » reflète l'état RÉEL : email confirmé côté auth.
  const verified = !!user.email_confirmed_at;
  const initial = (customer?.full_name ?? user.email ?? "C")
    .charAt(0)
    .toUpperCase();
  const addressLabel = wilayaName
    ? `${wilayaName}${customer?.default_commune ? ` · ${customer.default_commune}` : ""}`
    : t("myAddressesDesc");

  return (
    <CustomerShell hideHeader>
      <div className="mx-auto max-w-2xl pb-24">
        {/* HERO profil violet dégradé + anneaux décoratifs. */}
        <section className="from-primary-400 via-primary-600 to-primary-800 relative overflow-hidden bg-gradient-to-br px-5 pt-[calc(env(safe-area-inset-top)+1.75rem)] pb-16 text-white">
          <span className="pointer-events-none absolute -end-12 -top-16 size-52 rounded-full border border-white/15" />
          <span className="pointer-events-none absolute end-2 -top-8 size-32 rounded-full border border-white/10" />

          <div className="flex items-center justify-between">
            <p className="text-xs font-extrabold tracking-widest uppercase opacity-85">
              {t("myAccount")}
            </p>
            <Link
              href="/compte/infos"
              aria-label={t("settings")}
              className="grid size-9 place-items-center rounded-full bg-white/15 backdrop-blur transition-colors hover:bg-white/25"
            >
              <Settings className="size-[18px]" />
            </Link>
          </div>

          <div className="mt-5 flex items-center gap-3.5">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-white/30 bg-white/20 text-2xl font-black backdrop-blur">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[22px] leading-tight font-black tracking-tight">
                {customer?.full_name || t("myAccount")}
              </p>
              {customer?.phone && (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs font-bold opacity-90">
                  <Phone className="size-3.5" />
                  {customer.phone}
                </p>
              )}
              {verified && (
                // Vérifié = concept de réussite → vert (pastille blanche + coche
                // verte pour rester lisible sur le héro violet).
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10.5px] font-extrabold text-[#00854f] shadow-sm">
                  <BadgeCheck className="size-3" />
                  {t("verifiedAccount")}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Cartes soldes (cashback + Coligo Pay) qui CHEVAUCHENT le bas du hero.
            Masquées si la fonctionnalité est retirée, grisées si bientôt/maintenance. */}
        {visibleCount > 0 && (
          <div
            className={`relative z-10 -mt-11 grid gap-3 px-4 ${visibleCount === 2 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {cashbackVisible &&
              (cashbackActive ? (
                <Link
                  href="/cashback"
                  className="rounded-[18px] bg-white p-3.5 shadow-[0_12px_28px_-14px_rgba(40,35,90,.3)] transition-transform active:scale-[.97]"
                >
                  <div className="flex items-center justify-between">
                    <span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
                      <Gift className="size-[18px]" />
                    </span>
                    <ChevronRight className="text-subtle size-4 rtl:-scale-x-100" />
                  </div>
                  <p className="text-muted mt-2.5 text-[11.5px] font-extrabold">
                    {t("cashbackTitle")}
                  </p>
                  <p
                    className={`mt-0.5 text-xl font-black tabular-nums ${cashbackBalance > 0 ? "text-foreground" : "text-subtle"}`}
                  >
                    <WalletBalanceValue
                      kind="cashback"
                      userId={user.id}
                      initial={cashbackBalance}
                    />
                  </p>
                </Link>
              ) : (
                <div className="rounded-[18px] bg-white p-3.5 opacity-60 shadow-[0_12px_28px_-14px_rgba(40,35,90,.3)]">
                  <span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
                    <Gift className="size-[18px]" />
                  </span>
                  <p className="text-muted mt-2.5 text-[11.5px] font-extrabold">
                    {t("cashbackTitle")}
                  </p>
                  <p className="text-subtle mt-0.5 text-sm font-bold">
                    {disabledLabel(flags.cashback.status)}
                  </p>
                </div>
              ))}
            {payVisible &&
              (payActive ? (
                <Link
                  href="/coligo-pay"
                  className="rounded-[18px] bg-white p-3.5 shadow-[0_12px_28px_-14px_rgba(40,35,90,.3)] transition-transform active:scale-[.97]"
                >
                  <div className="flex items-center justify-between">
                    <span className="bg-primary-50 text-primary-600 grid size-9 place-items-center rounded-xl">
                      <Wallet className="size-[18px]" />
                    </span>
                    <ChevronRight className="text-subtle size-4 rtl:-scale-x-100" />
                  </div>
                  <p className="text-muted mt-2.5 text-[11.5px] font-extrabold">
                    Coligo Pay
                  </p>
                  <p
                    className={`mt-0.5 text-xl font-black tabular-nums ${topupBalance > 0 ? "text-foreground" : "text-subtle"}`}
                  >
                    <WalletBalanceValue
                      kind="topup"
                      userId={user.id}
                      initial={topupBalance}
                    />
                  </p>
                </Link>
              ) : (
                <div className="rounded-[18px] bg-white p-3.5 opacity-60 shadow-[0_12px_28px_-14px_rgba(40,35,90,.3)]">
                  <span className="bg-primary-50 text-primary-600 grid size-9 place-items-center rounded-xl">
                    <Wallet className="size-[18px]" />
                  </span>
                  <p className="text-muted mt-2.5 text-[11.5px] font-extrabold">
                    Coligo Pay
                  </p>
                  <p className="text-subtle mt-0.5 text-sm font-bold">
                    {disabledLabel(flags.coligo_pay.status)}
                  </p>
                </div>
              ))}
          </div>
        )}

        {completePhone && !customer?.phone && (
          <Link
            href="/compte/infos"
            className="border-warning-200 bg-warning-50 text-warning-800 mx-4 mt-4 block rounded-[14px] border px-4 py-3 text-sm font-medium"
          >
            {t.rich("completePhoneBanner", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </Link>
        )}

        {/* Section COMPTE */}
        <p className="text-muted px-5 pt-5 pb-2 text-[11px] font-extrabold tracking-wide uppercase">
          {t("sectionAccount")}
        </p>
        <div className="divide-border mx-4 divide-y overflow-hidden rounded-[20px] bg-white shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
          <MenuRow
            href="/compte/infos"
            tone="info"
            icon={<UserIcon className="size-[19px]" />}
            title={t("personalInfo")}
            subtitle={t("personalInfoDesc")}
          />
          <MenuRow
            href="/adresses"
            tone="info"
            icon={<MapPin className="size-[19px]" />}
            title={t("myAddresses")}
            subtitle={addressLabel}
          />
        </div>

        {/* Section ACTIVITÉ */}
        <p className="text-muted px-5 pt-5 pb-2 text-[11px] font-extrabold tracking-wide uppercase">
          {t("sectionActivity")}
        </p>
        <div className="divide-border mx-4 divide-y overflow-hidden rounded-[20px] bg-white shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
          <MenuRow
            href="/commandes"
            tone="orders"
            icon={<Receipt className="size-[19px]" />}
            title={t("myOrders")}
            subtitle={t("ordersTracking")}
            pill={
              ongoingCount > 0
                ? t("ordersInProgress", { count: ongoingCount })
                : undefined
            }
          />
          <MenuRow
            href="/favoris"
            tone="fav"
            icon={<Heart className="size-[19px] fill-current" />}
            title={t("myFavorites")}
            subtitle={t("favoritesDesc")}
          />
          <MenuRow
            href="/codes-promo"
            tone="promo"
            icon={<Ticket className="size-[19px]" />}
            title={t("promosCodes")}
            subtitle={t("promosCodesDesc")}
          />
        </div>

        {/* Section PRÉFÉRENCES — langue (FR / العربية), choix enregistré. */}
        <p className="text-muted px-5 pt-5 pb-2 text-[11px] font-extrabold tracking-wide uppercase">
          {t("sectionPreferences")}
        </p>
        <div className="divide-border mx-4 divide-y overflow-hidden rounded-[20px] bg-white shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
          <CustomerLanguageRow title={t("language")} />
        </div>

        {/* Section AIDE — live chat support (Tawk.to) */}
        <p className="text-muted px-5 pt-5 pb-2 text-[11px] font-extrabold tracking-wide uppercase">
          {t("sectionHelp")}
        </p>
        <div className="divide-border mx-4 divide-y overflow-hidden rounded-[20px] bg-white shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
          <CustomerSupportRow
            title={t("helpSupport")}
            subtitle={t("helpSupportDesc")}
          />
        </div>

        {/* Installer la PWA client (masqué si déjà installée / APK) */}
        <div className="px-4 pt-3">
          <InstallAppButton />
        </div>

        <div className="px-4">
          <CustomerLogoutButton />
        </div>

        {/* La suppression de compte vit dans « Informations personnelles »
            (brief « Reste a faire Coligo » §2) — plus de lien ici. */}

        {/* Version installée (APK uniquement) — utile au support. */}
        <AppVersionLabel />
      </div>
    </CustomerShell>
  );
}

const TONE: Record<string, string> = {
  info: "bg-[#E7F0FB] text-[#2E6FBF]",
  orders: "bg-primary-50 text-primary-600",
  fav: "bg-coral-50 text-coral-600",
  promo: "bg-primary-50 text-primary-600",
};

function MenuRow({
  href,
  icon,
  title,
  subtitle,
  tone,
  pill,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: keyof typeof TONE | string;
  pill?: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-surface-2 flex items-center gap-3 px-4 py-3.5 transition-colors"
    >
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${TONE[tone] ?? TONE.info}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-[15px] font-extrabold tracking-tight">
          {title}
        </span>
        <span className="text-muted block truncate text-xs font-medium">
          {subtitle}
        </span>
      </span>
      {pill ? (
        <span className="bg-primary-50 text-primary-700 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold">
          {pill}
        </span>
      ) : (
        <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
      )}
    </Link>
  );
}
