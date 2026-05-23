import { redirect } from "next/navigation";
import { Bell, Printer, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrintSettingsForm } from "@/components/merchant/print-settings-form";
import { SettingsSection } from "@/components/merchant/settings-section";
import {
  AUTO_PRINT_LABEL,
  DEFAULT_PRINT_SETTINGS,
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

  const { data: merchant } = await supabase
    .from("merchants")
    .select("name, auto_accept_orders, auto_print, print_copies, print_width")
    .eq("user_id", user.id)
    .maybeSingle();

  const settings: PrintSettings = merchant
    ? {
        auto_accept_orders: merchant.auto_accept_orders,
        auto_print: merchant.auto_print,
        print_copies: merchant.print_copies,
        print_width: merchant.print_width as PrintWidth,
      }
    : DEFAULT_PRINT_SETTINGS;

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Paramètres
        </h1>
        <p className="text-muted mt-1 text-sm">Réglages de votre boutique.</p>
      </header>

      <div className="space-y-3">
        <SettingsSection
          icon={<Printer />}
          title="Impression du ticket"
          description="Auto-acceptation, imprimante thermique et copies."
          defaultOpen
          summary={<PrintSummary settings={settings} />}
        >
          <PrintSettingsForm
            initial={settings}
            merchantName={merchant?.name ?? "Coligo"}
          />
        </SettingsSection>

        {/* Sections suivantes (placeholder) — décommenter quand prêtes.
            Le motif est en place : chaque section vit dans un accordéon
            indépendant, on en ajoute sans refactor. */}
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
          icon={<User />}
          title="Compte"
          description="Bientôt — profil et sécurité."
        >
          <p className="text-muted text-sm">
            Mise à jour du nom de la boutique, changement de mot de passe, etc.
            — bientôt disponible ici.
          </p>
        </SettingsSection>
      </div>
    </div>
  );
}

/**
 * Résumé inline (à droite de l'en-tête de section) — un coup d'œil et le
 * commerçant sait son état d'impression sans déplier.
 */
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
