import { useLocale } from "next-intl";
import { BRAND_VIOLET, SORA } from "@/components/shared/partner-ui";
import { DriverLogoutLink } from "@/components/driver/onboarding/driver-logout-link";

/**
 * Coque des écrans du PARCOURS D'INSCRIPTION livreur.
 *
 * Volontairement dépourvue de toute navigation métier : pas de barre du bas,
 * pas de tiroir, pas d'accès aux gains, au portefeuille ni aux tournées. Tant
 * que le compte n'est pas activé, le livreur ne dispose que de son dossier et
 * d'un bouton de déconnexion.
 */
export function OnboardingScreen({
  icon,
  title,
  subtitle,
  step,
  stepCount,
  children,
  footer,
  info,
}: {
  icon: React.ReactNode;
  title: string;
  /** UNE ligne, pas un paragraphe : le détail va dans `info` (bulle « i »). */
  subtitle: string;
  /** Rang de l'écran dans le parcours. OMIS quand l'écran porte DÉJÀ son propre
   *  fil d'Ariane (le dossier livreur) : deux numérotations « étape x sur 4 »
   *  sur le même écran se contredisent. */
  step?: number;
  stepCount?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Bulle d'information (mentions légales, précisions) — affichée à la demande. */
  info?: React.ReactNode;
}) {
  const isAr = useLocale() === "ar";
  return (
    <div className="min-h-[100dvh] bg-[var(--d-page)] text-[var(--d-ink)]">
      <main
        className="mx-auto max-w-md px-5 pt-[calc(2rem+env(safe-area-inset-top))]"
        style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }}
      >
        <header
          className="mb-5 text-center"
          style={{ animation: "driver-rise .4s ease-out both" }}
        >
          <span
            className="mx-auto mb-3 grid size-14 place-items-center rounded-full"
            style={{ background: "var(--violet-soft)", color: BRAND_VIOLET }}
          >
            {icon}
          </span>
          {step != null && stepCount != null && (
            <p className="text-[11px] font-bold tracking-[2px] text-[var(--muted)] uppercase">
              {isAr
                ? `الخطوة ${step} من ${stepCount}`
                : `Étape ${step} sur ${stepCount}`}
            </p>
          )}
          <h1
            className="mt-1 text-[22px] leading-tight font-extrabold text-[var(--ink)]"
            style={{ fontFamily: SORA }}
          >
            {title}
          </h1>
          <p className="mx-auto mt-2 flex max-w-[330px] items-center justify-center gap-1.5 text-[13px] leading-relaxed text-[var(--muted)]">
            {subtitle}
            {info}
          </p>
        </header>

        {children}

        <div className="mt-6 space-y-3 text-center">
          {footer}
          <DriverLogoutLink />
        </div>
      </main>
    </div>
  );
}
