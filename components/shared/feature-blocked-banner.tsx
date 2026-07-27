import { Clock, Lock, Wrench } from "lucide-react";
import {
  featureMessage,
  featureTitle,
  type FeatureFlag,
} from "@/lib/data/feature-flags";
import { cn } from "@/lib/utils";

// =============================================================================
// Bandeau « service suspendu par l'équipe Coligo » des ESPACES PARTENAIRES
// (chauffeur, livreur, agent). Quand le super-admin coupe une fonctionnalité
// (feature_flags mig 0182), le backend refuse déjà tout (triggers SQL) — ce
// bandeau explique CE QUI SE PASSE au lieu de laisser des actions échouer en
// silence. Titre/message personnalisés du flag s'ils existent, sinon défauts
// bilingues + message métier fourni par l'appelant.
//
// `variant="overlay"` : posé en FIXE sous la barre de statut (écrans carte
// plein écran, ex. accueil chauffeur) ; `"flow"` : dans le flux de la page.
// Server-safe (aucun hook) — la locale est résolue par l'appelant.
// =============================================================================

export function FeatureBlockedBanner({
  flag,
  locale,
  fallbackMessage,
  variant = "flow",
  className,
}: {
  flag: FeatureFlag;
  locale: string;
  /** Message métier par défaut, déjà dans la bonne langue. */
  fallbackMessage: string;
  variant?: "flow" | "overlay";
  className?: string;
}) {
  if (flag.status === "active") return null;
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
          ? "الخدمة متوقفة مؤقتًا"
          : "Service momentanément suspendu");
  const message = featureMessage(flag, locale) ?? fallbackMessage;

  return (
    <div
      role="status"
      className={cn(
        "border-warning-200 bg-warning-50 text-warning-900 flex items-start gap-3 rounded-[14px] border px-4 py-3 shadow-sm",
        variant === "overlay" &&
          "fixed inset-x-3 top-[calc(env(safe-area-inset-top)+8px)] z-40",
        className
      )}
    >
      <Icon className="text-warning-600 mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="text-warning-800 mt-0.5 text-xs leading-relaxed">
          {message}
        </p>
      </div>
    </div>
  );
}
