import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/utils";

// =============================================================================
// Drapeaux des langues — SVG INLINE (jamais d'emoji : rendu incohérent selon
// l'OS/WebView, cf. règle « pas d'emojis en dur »). Un drapeau = une langue :
//   fr → France · ar → ALGÉRIE (choix produit : l'arabe de Coligo, c'est
//   l'Algérie, pas un drapeau générique) · en → Royaume-Uni.
// Ratio 3:2 (viewBox 24×16), coins arrondis + liseré discret pour rester net
// sur fond blanc comme sur fond violet. Décoratif → aria-hidden.
// =============================================================================

function FlagFr({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 16"
      aria-hidden="true"
      className={cn(
        "rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]",
        className
      )}
    >
      <rect width="8" height="16" x="0" fill="#0055A4" />
      <rect width="8" height="16" x="8" fill="#FFFFFF" />
      <rect width="8" height="16" x="16" fill="#EF4135" />
    </svg>
  );
}

function FlagDz({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 16"
      aria-hidden="true"
      className={cn(
        "rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]",
        className
      )}
    >
      <rect width="12" height="16" x="0" fill="#006233" />
      <rect width="12" height="16" x="12" fill="#FFFFFF" />
      {/* Croissant (cercle extérieur − cercle intérieur, evenodd) ouvert vers
          le flottant, étoile à 5 branches dans l'ouverture. */}
      <path
        fillRule="evenodd"
        fill="#D21034"
        d="M8.2 8a4.2 4.2 0 1 0 8.4 0a4.2 4.2 0 1 0 -8.4 0 M10.5 8a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"
      />
      <polygon
        fill="#D21034"
        points="14.3,6.1 14.75,7.39 16.11,7.41 15.02,8.23 15.42,9.54 14.3,8.76 13.18,9.54 13.58,8.23 12.49,7.41 13.85,7.39"
      />
    </svg>
  );
}

function FlagGb({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 16"
      aria-hidden="true"
      className={cn(
        "rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]",
        className
      )}
    >
      <rect width="24" height="16" fill="#012169" />
      {/* Diagonales blanches puis rouges (Union Jack simplifié, lisible en 20 px). */}
      <path d="M0,0 L24,16 M24,0 L0,16" stroke="#FFFFFF" strokeWidth="3.2" />
      <path d="M0,0 L24,16 M24,0 L0,16" stroke="#C8102E" strokeWidth="1.6" />
      {/* Croix blanche + croix rouge. */}
      <path d="M12,0 V16 M0,8 H24" stroke="#FFFFFF" strokeWidth="5" />
      <path d="M12,0 V16 M0,8 H24" stroke="#C8102E" strokeWidth="2.8" />
    </svg>
  );
}

/**
 * Drapeau de la langue donnée. `className` pilote la taille (défaut compact
 * `w-5` ≈ 20×13). Purement décoratif : toujours accompagné du libellé texte.
 */
export function LocaleFlag({
  locale,
  className = "w-5",
}: {
  locale: Locale;
  className?: string;
}) {
  if (locale === "ar") return <FlagDz className={className} />;
  if (locale === "en") return <FlagGb className={className} />;
  return <FlagFr className={className} />;
}
