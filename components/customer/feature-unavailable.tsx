import { Clock, Lock, Wrench } from "lucide-react";
import type { FeatureStatus } from "@/lib/data/feature-flags";

// =============================================================================
// Bandeau d'indisponibilité d'une fonctionnalité (Drive, Coligo Pay, cashback…).
// Présentation pure (utilisable en Server Component). Le message vient du
// super-admin (feature_flags) ; titre par défaut selon l'état.
//
// `personal` = la coupure ne vise QUE ce compte (mig 0397). On change l'icône
// et le titre par défaut : dire « temporairement indisponible » à quelqu'un
// dont le compte est restreint serait faux — et l'enverrait attendre un
// rétablissement qui ne viendra pas tout seul.
// =============================================================================

export function FeatureUnavailable({
  status,
  title,
  message,
  personal = false,
  className = "",
}: {
  status: FeatureStatus;
  title?: string | null;
  message?: string | null;
  personal?: boolean;
  className?: string;
}) {
  const comingSoon = status === "coming_soon";
  const Icon = personal ? Lock : comingSoon ? Clock : Wrench;
  const fallbackTitle = personal
    ? "Désactivé sur votre compte"
    : comingSoon
      ? "Bientôt disponible"
      : "Temporairement indisponible";

  return (
    <div
      role="status"
      className={`border-warning-200 bg-warning-50 text-warning-900 flex items-start gap-3 rounded-[16px] border px-4 py-4 ${className}`}
    >
      <Icon className="text-warning-600 mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title || fallbackTitle}</p>
        {message && (
          <p className="text-warning-800 mt-1 leading-relaxed">{message}</p>
        )}
      </div>
    </div>
  );
}
