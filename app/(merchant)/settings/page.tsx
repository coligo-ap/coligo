import { redirect } from "next/navigation";
import {
  Bell,
  Clock,
  Printer,
  Store,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrintSettingsForm } from "@/components/merchant/print-settings-form";
import { SettingsSection } from "@/components/merchant/settings-section";
import { ProfileForm } from "@/components/merchant/settings/profile-form";
import { OpeningHoursForm } from "@/components/merchant/settings/opening-hours-form";
import { OrderRulesForm } from "@/components/merchant/settings/order-rules-form";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { AccountSection } from "@/components/merchant/settings/account-section";
import { normalizeOpeningHours } from "@/lib/merchant/opening-hours";
import {
  AUTO_PRINT_LABEL,
  DEFAULT_PRINT_SETTINGS,
  type MerchantSettings,
  type OpeningHours,
  type PrintSettings,
  type PrintWidth,
} from "@/lib/types";

export const dynamic = "force-dynamic";

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
       commission_rate, auto_accept_orders, auto_print, print_copies, print_width`
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
  };

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

      <div className="space-y-3">
        <SettingsSection
          icon={<Store />}
          title="Profil du commerce"
          description="Vitrine visible des clients (logo, description, adresse, contact)."
          summary={
            <span className="text-muted mr-2 text-xs">
              {merchant.logo_url ? "Logo OK" : "Pas de logo"}
            </span>
          }
          defaultOpen
        >
          <ProfileForm merchant={merchant} />
        </SettingsSection>

        <SettingsSection
          icon={<Clock />}
          title="Horaires d'ouverture"
          description="Définissez vos créneaux jour par jour (pause possible)."
          summary={<OpenStatusBadge hours={merchant.opening_hours} />}
        >
          <OpeningHoursForm initial={merchant.opening_hours} />
        </SettingsSection>

        <SettingsSection
          icon={<Wallet />}
          title="Règles de commande"
          description="Montant minimum, délai de préparation, paiements, créneaux."
          summary={
            <span className="text-muted mr-2 text-xs tabular-nums">
              Min {merchant.min_order_da} DA · {merchant.prep_time_min} min ·{" "}
              {merchant.pickup_slot_minutes} min/créneau
            </span>
          }
        >
          <OrderRulesForm merchant={merchant} />
        </SettingsSection>

        <SettingsSection
          icon={<Printer />}
          title="Impression du ticket"
          description="Auto-acceptation, imprimante thermique et copies."
          summary={<PrintSummary settings={printSettings} />}
        >
          <PrintSettingsForm
            initial={printSettings}
            merchantName={merchant.name}
          />
        </SettingsSection>

        <SettingsSection
          icon={<Bell />}
          title="Notifications"
          description="Bientôt — sons, push, e-mails."
        >
          <p className="text-muted text-sm">
            La configuration fine des notifications arrive prochainement. Pour
            l&apos;instant, gérez le son et les notifs depuis le panneau
            d&apos;alertes du tableau de bord.
          </p>
        </SettingsSection>

        <SettingsSection
          icon={<UserIcon />}
          title="Compte"
          description="Email, mot de passe, déconnexion."
        >
          <AccountSection
            email={user.email ?? ""}
            commissionRatePct={Math.round(merchant.commission_rate * 100)}
          />
        </SettingsSection>
      </div>
    </div>
  );
}

function PrintSummary({ settings }: { settings: PrintSettings }) {
  const parts: string[] = [
    settings.auto_accept_orders ? "Auto-accept ON" : "Auto-accept OFF",
    `Print : ${AUTO_PRINT_LABEL[settings.auto_print]}`,
    `${settings.print_copies}× · ${settings.print_width} mm`,
  ];
  return (
    <span className="text-muted mr-2 text-xs tabular-nums">
      {parts.join(" · ")}
    </span>
  );
}
