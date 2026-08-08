import Link from "next/link";
import { getLocale } from "next-intl/server";
import { ArrowRight, Clock, Lock, Wrench } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import {
  featureMessage,
  featureTitle,
  getEffectiveFlags,
  type FeatureFlag,
} from "@/lib/data/feature-flags";
import { cn } from "@/lib/utils";

// =============================================================================
// ÉCRAN PLEIN d'indisponibilité d'un DOMAINE client (Drive, Coligo Pay,
// cashback, roue, parrainage…) quand le super-admin le met en « bientôt
// disponible » ou en maintenance (feature_flags mig 0182, coupure perso 0397).
//
// Remplace les pages BLANCHES sans navigation : icône sur tuile au dégradé du
// thème, titre + message (personnalisés par l'admin s'ils existent), bouton
// retour accueil 44 px, et — pour les routes NUES sans coque (ex. /drive) —
// la barre de navigation du bas est RENDUE ICI (`withNav`) pour que le client
// ne soit jamais coincé. Le backend refuse déjà tout (triggers SQL) : cet
// écran explique, il ne protège pas. Bilingue FR/AR.
// =============================================================================

export async function CustomerFeatureBlocked({
  flag,
  withNav = false,
  homeHref = "/",
}: {
  flag: FeatureFlag;
  /** Routes NUES (sans CustomerChrome, ex. /drive) : rendre la nav du bas ici. */
  withNav?: boolean;
  homeHref?: string;
}) {
  const [locale, flags] = await Promise.all([getLocale(), getEffectiveFlags()]);
  const isAr = locale === "ar";
  const comingSoon = flag.status === "coming_soon";
  const Icon = flag.personal ? Lock : comingSoon ? Clock : Wrench;

  const title =
    featureTitle(flag, locale) ??
    (flag.personal
      ? isAr
        ? "معطّل على حسابك"
        : "Désactivé sur votre compte"
      : comingSoon
        ? isAr
          ? "متاح قريبًا"
          : "Bientôt disponible"
        : isAr
          ? "غير متاح مؤقتًا"
          : "Temporairement indisponible");
  const message =
    featureMessage(flag, locale) ??
    (comingSoon
      ? isAr
        ? "نُحضّر هذه الخدمة بعناية — القليل من الصبر."
        : "L'équipe Coligo prépare cette nouveauté — encore un peu de patience."
      : isAr
        ? "الخدمة تعود قريبًا جدًا. شكرًا على تفهمك."
        : "Le service revient très vite. Merci de votre patience.");

  // Même logique d'onglets masqués que CustomerChrome.
  const hiddenKeys: string[] = [];
  if (flags.drive.status === "hidden") hiddenKeys.push("drive");
  if (flags.coligo_pay.status === "hidden") hiddenKeys.push("pay");

  return (
    <div className={cn(withNav && "bg-surface min-h-dvh pb-24")}>
      <div
        className={cn(
          "mx-auto flex w-full max-w-md flex-col items-center px-6 text-center",
          withNav
            ? "min-h-[78dvh] justify-center pt-[calc(env(safe-area-inset-top)+2rem)]"
            : "justify-center py-14"
        )}
      >
        {/* Tuile icône au dégradé du thème « occasion » (vars sur <html>). */}
        <div
          className="rounded-panel-lg grid size-20 place-items-center text-white shadow-[0_18px_40px_-18px_rgba(76,27,155,.55)]"
          style={{
            backgroundImage:
              "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g3,#4C1B9B) 100%)",
          }}
        >
          <Icon className="size-9 drop-shadow-sm" />
        </div>

        <h1 className="text-foreground mt-5 text-xl font-extrabold tracking-tight">
          {title}
        </h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">{message}</p>

        <Link
          href={homeHref}
          className={cn(buttonVariants(), "mt-6 w-full max-w-xs")}
        >
          {isAr ? "العودة إلى الرئيسية" : "Retour à l'accueil"}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </Link>
        <Link
          href="/commandes"
          className="text-muted hover:text-foreground mt-3 inline-flex min-h-[44px] items-center text-sm font-medium"
        >
          {isAr ? "طلباتي" : "Voir mes commandes"}
        </Link>
      </div>

      {withNav && <CustomerBottomNav hiddenKeys={hiddenKeys} />}
    </div>
  );
}
