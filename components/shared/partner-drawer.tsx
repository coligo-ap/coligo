"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronRight, Menu, X } from "lucide-react";
import { Portal } from "@/components/ui/portal";

/**
 * Tiroir latéral GAUCHE partagé par les espaces partenaires (chauffeur ET
 * livreur) — socle UI commun pour une expérience UNIE et cohérente (style Uber).
 *
 * Le principe (demandé) : l'accueil partenaire ne garde QUE le bouton de mise en
 * ligne ; toutes les options (zone de travail, domicile, abonnement, gains,
 * portefeuille, compte, tournées…) sont regroupées ICI, derrière un bouton menu.
 *
 * Le composant est PRÉSENTATIONNEL et THÉMABLE : chaque espace a sa propre
 * palette (le chauffeur en `--d-*`, le livreur en `--surface/--ink/…`). On
 * mappe ces jetons sur des variables internes `--pd-*` posées sur la racine du
 * tiroir, si bien que le markup reste identique partout et s'habille tout seul.
 */
export type DrawerTheme = {
  surface: string;
  line: string;
  ink: string;
  muted: string;
  soft: string;
  accent: string;
};

function themeVars(t: DrawerTheme): React.CSSProperties {
  return {
    ["--pd-surface" as string]: t.surface,
    ["--pd-line" as string]: t.line,
    ["--pd-ink" as string]: t.ink,
    ["--pd-muted" as string]: t.muted,
    ["--pd-soft" as string]: t.soft,
    ["--pd-accent" as string]: t.accent,
  };
}

/** Bouton « menu » (hamburger) à poser en haut à gauche de l'accueil. */
export function PartnerMenuButton({
  onClick,
  theme,
  label,
  badge,
  className,
}: {
  onClick: () => void;
  theme: DrawerTheme;
  label: string;
  /** Pastille de notification (ex. nb de demandes en attente). */
  badge?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={
        "relative grid size-[44px] place-items-center rounded-lg border shadow-lg " +
        (className ?? "")
      }
      style={{
        background: theme.surface,
        borderColor: theme.line,
        color: theme.accent,
      }}
    >
      <Menu className="size-5" />
      {badge != null && badge > 0 && (
        <span
          className="text-micro absolute -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 font-extrabold text-white shadow"
          style={{ insetInlineEnd: -4, background: theme.accent }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

/** Section de tiroir avec titre discret. */
export function DrawerSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2">
      {title && (
        <p className="text-caption px-3 pb-1.5 font-bold tracking-wide text-[var(--pd-muted)] uppercase">
          {title}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-[var(--pd-line)] bg-[var(--pd-surface)]">
        {children}
      </div>
    </div>
  );
}

/**
 * Ligne du tiroir (icône · libellé · sous-libellé · zone droite). Devient un
 * lien (`href`) ou un bouton (`onClick`). Le `trailing` permet d'y greffer un
 * interrupteur, un chevron, une valeur…
 */
export function DrawerRow({
  icon,
  label,
  sublabel,
  trailing,
  onClick,
  href,
  danger,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const inner = (
    <>
      <span
        className="rounded-control-lg grid size-9 shrink-0 place-items-center"
        style={{
          background: danger ? "rgba(229,72,77,.10)" : "var(--pd-soft)",
          color: danger ? "#E5484D" : "var(--pd-accent)",
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-start">
        <b
          className="text-body block font-semibold"
          style={{ color: danger ? "#E5484D" : "var(--pd-ink)" }}
        >
          {label}
        </b>
        {sublabel && (
          <span className="text-caption-lg block truncate text-[var(--pd-muted)]">
            {sublabel}
          </span>
        )}
      </span>
      {trailing ?? (
        <ChevronRight className="size-4 shrink-0 text-[var(--pd-muted)]" />
      )}
    </>
  );
  const cls =
    "flex w-full items-center gap-3 px-3.5 py-3 text-start transition-colors active:bg-[var(--pd-soft)]";
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** Séparateur fin entre deux lignes d'un même groupe. */
export function DrawerDivider() {
  return <div className="mx-3.5 h-px bg-[var(--pd-line)]" />;
}

/**
 * Coque du tiroir : voile + panneau coulissant depuis la GAUCHE. Verrouille le
 * scroll, ferme sur Échap / clic voile, et reste monté (transitions d'ouverture
 * fluides) tant que `open` pilote l'animation.
 */
export function PartnerDrawer({
  open,
  onClose,
  theme,
  header,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  theme: DrawerTheme;
  /** En-tête (profil, statut, finance…) — collé en haut, non scrollé. */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Pied collant (ex. déconnexion). */
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <Portal>
      {/* Voile */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-[120] bg-black/45 transition-opacity duration-300"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
      />
      {/* Panneau (gauche) */}
      <aside
        role="dialog"
        aria-modal="true"
        className="fixed inset-y-0 left-0 z-[121] flex w-[86%] max-w-[360px] flex-col border-e shadow-2xl transition-transform duration-300 ease-out"
        style={{
          ...themeVars(theme),
          background: theme.surface,
          borderColor: theme.line,
          transform: open ? "translateX(0)" : "translateX(-102%)",
        }}
      >
        {/* Barre de fermeture */}
        <div className="flex items-center justify-end px-3 pt-[calc(10px+env(safe-area-inset-top))] pb-1">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-9 place-items-center rounded-full"
            style={{ background: theme.soft, color: theme.muted }}
          >
            <X className="size-4" />
          </button>
        </div>

        {header && <div className="px-4 pb-1">{header}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
          {children}
        </div>

        {footer && (
          <div
            className="border-t px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
            style={{ borderColor: theme.line }}
          >
            {footer}
          </div>
        )}
      </aside>
    </Portal>
  );
}
