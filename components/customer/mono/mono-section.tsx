import { cn } from "@/lib/utils";

// =============================================================================
// MonoSection — le COLOR-BLOCKING du thème « bold minimalism ».
//
// Chaque section de la home devient un bloc plein largeur (marge latérale
// 16 px), fond alterné gris chaud / crème, coins 28 px, padding 24 px. AUCUNE
// bordure, AUCUNE ombre : ce sont ces blocs qui remplacent tous les
// séparateurs `<hr>` / `border-t` — il n'en reste aucun dans le thème.
//
// La hiérarchie passe par la TAILLE et le POIDS du titre, jamais par une
// couleur de texte : titres et corps sont en --ink, seuls les sous-titres
// descendent en --ink-muted.
// =============================================================================

export function MonoSection({
  tone = "a",
  title,
  subtitle,
  action,
  children,
  className,
}: {
  /** Alternance des fonds de section : "a" gris chaud, "b" crème. */
  tone?: "a" | "b";
  title?: string;
  subtitle?: string;
  /** Lien / bouton posé à droite du titre (« Tout voir »). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "mx-4 rounded-[var(--radius-section)] p-6",
        tone === "a"
          ? "bg-[var(--surface-section-a)]"
          : "bg-[var(--surface-section-b)]",
        className
      )}
    >
      {title && (
        <header className="mb-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[30px] leading-[1.1] font-extrabold tracking-[-0.02em] text-[var(--ink)]">
              {title}
            </h2>
            {subtitle && (
              <p className="text-title-sm mt-2 font-normal text-[var(--ink-muted)]">
                {subtitle}
              </p>
            )}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Lien discret d'en-tête de section — noir, jamais coloré. */
export function MonoSectionLink({
  children,
  href = "#",
}: {
  children: React.ReactNode;
  href?: string;
}) {
  return (
    <a
      href={href}
      className="text-body-lg shrink-0 font-medium text-[var(--ink)] underline underline-offset-4"
    >
      {children}
    </a>
  );
}
