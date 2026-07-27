import { getLocale } from "next-intl/server";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import { FeatureBlockedBanner } from "@/components/shared/feature-blocked-banner";

/**
 * Bandeau serveur de la coque chauffeur : quand le super-admin suspend Coligo
 * Drive, le chauffeur le VOIT (overlay fixe, visible même sur la carte) au
 * lieu de rester devant un écran sans offres qui « ne marche plus ». Le
 * dispatch serveur (mig 0182 : get_nearby vide + trigger rides) refuse déjà
 * tout — ici on explique. Gains/historique/compte restent utilisables.
 */
export async function ChauffeurFeatureNotice() {
  const [flags, locale] = await Promise.all([getFeatureFlags(), getLocale()]);
  const isAr = locale === "ar";
  return (
    <FeatureBlockedBanner
      flag={flags.drive}
      locale={locale}
      variant="overlay"
      fallbackMessage={
        isAr
          ? "علّق فريق كوليڨو المشاوير الجديدة مؤقتًا. أرباحك وسجلّك وحسابك تبقى متاحة."
          : "L'équipe Coligo a suspendu temporairement les nouvelles courses. Vos gains, votre historique et votre compte restent accessibles."
      }
    />
  );
}
