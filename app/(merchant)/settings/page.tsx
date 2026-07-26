import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronRight,
  Clock,
  LayoutGrid,
  Printer,
  Smartphone,
  Store,
  Truck,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrintSettingsForm } from "@/components/merchant/print-settings-form";
import { SettingsSection } from "@/components/merchant/settings-section";
import { ProfileForm } from "@/components/merchant/settings/profile-form";
import { OpeningHoursForm } from "@/components/merchant/settings/opening-hours-form";
import { ScheduledClosureForm } from "@/components/merchant/settings/scheduled-closure-form";
import { OrderRulesForm } from "@/components/merchant/settings/order-rules-form";
import { CatalogDisplayForm } from "@/components/merchant/settings/catalog-display-form";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { AccountSection } from "@/components/merchant/settings/account-section";
import { DeliverySettingsForm } from "@/components/merchant/settings/delivery-settings-form";
import { NotificationsForm } from "@/components/merchant/settings/notifications-form";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import { PayoutSettingsForm } from "@/components/merchant/settings/payout-settings-form";
import { normalizeOpeningHours } from "@/lib/merchant/opening-hours";
import { getPlatformSettings } from "@/lib/data/platform";
import {
  AUTO_PRINT_LABEL,
  DEFAULT_PRINT_SETTINGS,
  type DeliveryPricing,
  type MerchantDeliverySettings,
  type MerchantSettings,
  type OpeningHours,
  type PrintSettings,
  type PrintWidth,
} from "@/lib/types";

export const dynamic = "force-dynamic";

import { IdvCallout } from "@/components/idv/idv-callout";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: m } = await supabase
    .from("merchants")
    .select(
      `id, name, slug, category, city, wilaya_code, commune, address,
       latitude, longitude, description_fr, description_ar,
       logo_url, cover_url, phone_public, opening_hours,
       min_order_da, prep_time_min, accepts_cash, accepts_online,
       pickup_slot_minutes, max_orders_per_slot, is_active,
       commission_rate, auto_accept_orders, auto_print, print_copies, print_width, print_lang,
       delivery_enabled, express_enabled, tours_enabled, delivery_radius_km,
       closure_start, closure_end, tags, catalog_display,
       payout_auto, payout_method, payout_details`
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (!m) redirect("/login?error=no_merchant");

  const printSettings: PrintSettings = {
    auto_accept_orders: m.auto_accept_orders ?? false,
    auto_print: m.auto_print ?? "off",
    print_copies: m.print_copies ?? DEFAULT_PRINT_SETTINGS.print_copies,
    print_width: (m.print_width ??
      DEFAULT_PRINT_SETTINGS.print_width) as PrintWidth,
    // Langue unique du ticket — 'fr' par défaut, jamais FR/AR mélangés.
    print_lang:
      (m as { print_lang?: string | null }).print_lang === "ar" ? "ar" : "fr",
  };

  const deliverySettings: MerchantDeliverySettings & {
    latitude: number | null;
    longitude: number | null;
  } = {
    delivery_enabled: m.delivery_enabled ?? false,
    express_enabled: m.express_enabled ?? false,
    tours_enabled: m.tours_enabled ?? false,
    delivery_radius_km: m.delivery_radius_km ?? null,
    latitude: m.latitude ?? null,
    longitude: m.longitude ?? null,
  };

  // Zones de prix tournée (créées à la volée si absentes).
  await supabase.rpc("ensure_merchant_delivery_zones", { p_merchant_id: m.id });
  const { data: zoneRows } = await supabase
    .from("merchant_delivery_zones")
    .select("band_index, max_km, price_da")
    .eq("merchant_id", m.id)
    .order("band_index", { ascending: true });
  const tourZones = (zoneRows ?? []).map((z) => ({
    band_index: z.band_index as number,
    max_km: Number(z.max_km),
    price_da: z.price_da as number,
  }));

  const platform = await getPlatformSettings();
  const deliveryPricing: DeliveryPricing | null = platform
    ? {
        delivery_base_da: platform.delivery_base_da,
        delivery_per_km_da: platform.delivery_per_km_da,
        delivery_free_km_threshold: platform.delivery_free_km_threshold,
        delivery_min_da: platform.delivery_min_da,
        delivery_max_da: platform.delivery_max_da,
        delivery_max_radius_km: platform.delivery_max_radius_km,
      }
    : null;

  const merchant: MerchantSettings = {
    id: m.id,
    name: m.name,
    slug: m.slug,
    category: m.category,
    city: m.city,
    wilaya_code: m.wilaya_code,
    commune: m.commune,
    address: m.address,
    latitude: m.latitude,
    longitude: m.longitude,
    description_fr: m.description_fr,
    description_ar: m.description_ar,
    logo_url: m.logo_url,
    cover_url: m.cover_url,
    phone_public: m.phone_public,
    opening_hours: normalizeOpeningHours(
      m.opening_hours as OpeningHours | null
    ),
    min_order_da: m.min_order_da,
    prep_time_min: m.prep_time_min,
    accepts_cash: m.accepts_cash,
    accepts_online: m.accepts_online,
    pickup_slot_minutes: m.pickup_slot_minutes,
    max_orders_per_slot: m.max_orders_per_slot,
    commission_rate: m.commission_rate,
    is_active: m.is_active,
    tags: (m.tags as string[] | null) ?? [],
    payout_auto:
      (m.payout_auto as "none" | "weekly" | "monthly" | null) ?? "none",
    payout_method: m.payout_method ?? null,
    payout_details: m.payout_details ?? null,
    catalog_display:
      (m.catalog_display as string | null) === "categories"
        ? "categories"
        : "list",
  };

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Paramètres
        </h1>
        <p className="text-muted mt-1 text-sm">
          Profil vitrine, horaires, règles de commande, impression et compte.
        </p>
      </header>

      {/* Vérification d'identité du titulaire (IDV) : la bannière s'efface
          d'elle-même si la fonctionnalité n'est pas publiée pour ce profil ou
          si l'identité est déjà vérifiée. */}
      <div className="mb-3">
        <IdvCallout profile="merchant" />
      </div>

      <div className="space-y-3">
        <SettingsSection
          icon={<Store />}
          title="Profil du commerce"
          description="Ce que voient les clients : logo, adresse, contact."
          summary={
            <span className="text-muted mr-2 text-xs">
              {merchant.logo_url ? "Logo OK" : "Pas de logo"}
            </span>
          }
        >
          <ProfileForm merchant={merchant} />
        </SettingsSection>

        <SettingsSection
          icon={<LayoutGrid />}
          title="Affichage du catalogue"
          description="Comment les clients découvrent vos produits sur votre boutique."
          summary={
            <span className="text-muted mr-2 text-xs">
              {merchant.catalog_display === "categories"
                ? "Catégories d'abord"
                : "Liste complète"}
            </span>
          }
        >
          <CatalogDisplayForm initial={merchant.catalog_display} />
        </SettingsSection>

        <SettingsSection
          icon={<Clock />}
          title="Horaires d'ouverture"
          description="Créneaux jour par jour et fermeture exceptionnelle."
          summary={<OpenStatusBadge hours={merchant.opening_hours} />}
        >
          <OpeningHoursForm initial={merchant.opening_hours} />
          <ScheduledClosureForm
            initialStart={m.closure_start}
            initialEnd={m.closure_end}
          />
        </SettingsSection>

        <SettingsSection
          icon={<Wallet />}
          title="Règles de commande"
          description="Minimum, délai de préparation et paiements."
          summary={
            <span className="text-muted mr-2 text-xs tabular-nums">
              Min {merchant.min_order_da} DA · {merchant.prep_time_min} min
            </span>
          }
        >
          <OrderRulesForm merchant={merchant} />
        </SettingsSection>

        <SettingsSection
          icon={<Truck />}
          title="Livraison"
          description="Modes (Express/Tournée), rayon et tarifs."
          summary={
            <DeliverySummary
              settings={deliverySettings}
              maxRadiusKm={deliveryPricing?.delivery_max_radius_km}
            />
          }
        >
          {deliveryPricing ? (
            <DeliverySettingsForm
              pricing={deliveryPricing}
              current={deliverySettings}
              zones={tourZones}
            />
          ) : (
            <p className="text-muted text-sm">
              Barème plateforme indisponible — réessaie plus tard.
            </p>
          )}
        </SettingsSection>

        <SettingsSection
          icon={<Printer />}
          title="Impression & alertes"
          description="Auto-acceptation, ticket, son et notifications."
          summary={<PrintSummary settings={printSettings} />}
        >
          <PrintSettingsForm
            initial={printSettings}
            merchantName={merchant.name}
          />
          <div className="border-border mt-6 border-t pt-5">
            <h3 className="text-foreground text-sm font-semibold">
              Alertes sur cet appareil
            </h3>
            <p className="text-muted mb-2 text-xs">
              Son, notifications système et mode comptoir.
            </p>
            <NotificationsForm />
          </div>
        </SettingsSection>

        <SettingsSection
          icon={<Wallet />}
          title="Versements"
          description="Fréquence et coordonnées CCP/RIB."
          summary={
            <span className="text-muted mr-2 text-xs">
              {PAYOUT_AUTO_LABEL[merchant.payout_auto ?? "none"]}
              {merchant.payout_method
                ? ` · ${merchant.payout_method.toUpperCase()}`
                : ""}
            </span>
          }
        >
          <PayoutSettingsForm
            payoutAuto={
              (merchant.payout_auto as "none" | "weekly" | "monthly") ?? "none"
            }
            payoutMethod={merchant.payout_method ?? null}
            payoutDetails={merchant.payout_details ?? null}
          />
        </SettingsSection>

        <SettingsSection
          icon={<UserIcon />}
          title="Compte"
          description="Email, mot de passe, déconnexion."
          summary={
            <span className="text-muted mr-2 max-w-[220px] truncate text-xs">
              {user.email}
            </span>
          }
        >
          <AccountSection
            email={user.email ?? ""}
            commissionRatePct={Math.round(merchant.commission_rate * 100)}
          />
        </SettingsSection>

        {/* Portefeuille & recharge (solde, carte/CCP, points proches) */}
        <Link
          href="/recharger"
          className="border-border hover:bg-surface-2 flex w-full items-center gap-3 rounded-[14px] border bg-white p-4 text-start transition-colors"
        >
          <span className="bg-primary-50 text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
            <Wallet className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Portefeuille & recharge
            </span>
            <span className="text-muted block text-xs">
              Solde, recharge par carte/CCP et points proches.
            </span>
          </span>
          <ChevronRight className="text-subtle size-5 shrink-0" />
        </Link>

        {/* Télécharger l'APK Android (impression thermique Sunmi) */}
        <Link
          href="/telecharger"
          className="border-border hover:bg-surface-2 flex w-full items-center gap-3 rounded-[14px] border bg-white p-4 text-start transition-colors"
        >
          <span className="bg-primary-50 text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
            <Smartphone className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Télécharger l’application Android
            </span>
            <span className="text-muted block text-xs">
              Requise pour imprimer les tickets sur l’imprimante intégrée.
            </span>
          </span>
          <ChevronRight className="text-subtle size-5 shrink-0" />
        </Link>

        {/* Installer la PWA commerçant (« Coligo Commerçant ») — masqué si installée/APK */}
        <InstallAppButton />
      </div>
    </div>
  );
}

const PAYOUT_AUTO_LABEL: Record<string, string> = {
  none: "À la demande",
  weekly: "Hebdomadaire",
  monthly: "Mensuel",
};

function DeliverySummary({
  settings,
  maxRadiusKm,
}: {
  settings: MerchantDeliverySettings;
  maxRadiusKm?: number;
}) {
  if (!settings.delivery_enabled) {
    return (
      <span className="text-muted mr-2 text-xs">Livraison désactivée</span>
    );
  }
  const modes: string[] = [];
  if (settings.express_enabled) modes.push("Express");
  if (settings.tours_enabled) modes.push("Tournée");
  const r = settings.delivery_radius_km;
  return (
    <span className="text-muted mr-2 text-xs tabular-nums">
      {modes.join(" · ") || "Aucun mode"} ·{" "}
      {r != null ? `${r.toFixed(1)} km` : "rayon ?"}
      {maxRadiusKm != null && r != null && r >= maxRadiusKm && " (max)"}
    </span>
  );
}

function PrintSummary({ settings }: { settings: PrintSettings }) {
  const parts: string[] = [
    settings.auto_accept_orders ? "Auto-accept ON" : "Auto-accept OFF",
    `Print : ${AUTO_PRINT_LABEL[settings.auto_print]}`,
    `${settings.print_copies}× · ${settings.print_width} mm · ${
      settings.print_lang === "ar" ? "AR" : "FR"
    }`,
  ];
  return (
    <span className="text-muted mr-2 text-xs tabular-nums">
      {parts.join(" · ")}
    </span>
  );
}
