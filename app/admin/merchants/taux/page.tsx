import { getPlatformSettings } from "@/lib/data/platform";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";
import { ModulePaymentAccount } from "@/components/admin/module-payment-account";

export const dynamic = "force-dynamic";

// Onglet « Taux & paiement » du hub Commerçants : taux/commissions globaux
// (surchargés par commerçant dans l'onglet Comptes) + compte de versement
// plateforme affiché aux commerçants pour la recharge par virement.
export default async function MerchantRatesTab() {
  const settings = await getPlatformSettings();

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-foreground text-base font-bold">
          Taux de la plateforme
        </h2>
        <p className="text-muted mt-0.5 mb-4 text-sm">
          Valeurs par défaut globales. Chaque commerçant peut les surcharger
          depuis l&apos;onglet Comptes.
        </p>
        {settings ? (
          <PlatformSettingsForm settings={settings} />
        ) : (
          <p className="text-danger-600 text-sm">
            Configuration introuvable (platform_settings vide).
          </p>
        )}
      </section>

      <ModulePaymentAccount scope="merchant" />
    </div>
  );
}
