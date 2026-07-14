"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogOut,
  type LucideIcon,
} from "lucide-react";

/**
 * SOCLE UI PARTAGÉ LIVREUR + CHAUFFEUR (style Uber / maquettes Coligo).
 *
 * Toutes les primitives sont écrites en tokens `--d-*` : natifs dans l'espace
 * chauffeur/Drive (globals.css) et ALIASÉS dans l'espace livreur
 * ([data-space="driver"], cf. maquette.css) → un même composant rend
 * correctement (clair + sombre) dans les DEUX espaces, sans prop de thème.
 *
 * Complète (ne remplace pas) `partner-drawer.tsx` / `partner-sheet.tsx`.
 */

/** Violet de marque unifié (cf. mémoire « Couleurs de marque »). */
export const BRAND_VIOLET = "#6c2bd9";
export const BRAND_VIOLET_D = "#4b1fa6";
export const BRAND_GO = "#16b364";
export const BRAND_RED = "#e5484d";
export const BRAND_AMBER = "#f59e0b";
/** Police titres/chiffres (Sora), exposée par les 2 layouts partenaires. */
export const SORA = 'var(--font-sora), "Sora", system-ui, sans-serif';

/* ─────────────────────────── Tabbar (nav basse) ─────────────────────────── */

export type PartnerTab = {
  href: string;
  label: string;
  labelAr: string;
  icon: LucideIcon;
  /** Actif seulement si le chemin est EXACT (ex. racine de l'espace). */
  exact?: boolean;
  /** Préfixes SUPPLÉMENTAIRES qui activent l'onglet (ex. hub à sous-routes). */
  match?: readonly string[];
};

/**
 * Barre d'onglets persistante commune (Accueil · … · Compte). Config-driven :
 * chaque espace fournit ses onglets ; hauteur ajustable (74 px livreur pour
 * caler la feuille d'accueil, 66 px chauffeur).
 */
export function PartnerTabbar({
  items,
  height = 66,
  ariaLabel = "Navigation",
}: {
  items: readonly PartnerTab[];
  height?: number;
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  const isAr = useLocale() === "ar";
  return (
    /*
     * La zone sûre s'AJOUTE à la barre, elle ne la rogne pas.
     *
     * Avant : `height: 66px` était posé sur la <nav> elle-même, et le
     * `padding-bottom: env(safe-area-inset-bottom)` en était retranché
     * (`box-sizing: border-box`). Sur un téléphone à gesture bar de 48 px il ne
     * restait que 18 px pour des icônes qui en font 37 : elles débordaient
     * SOUS la barre système. C'est le montage du commerçant qui est correct
     * (cf. `merchant/mobile-bottom-nav.tsx`) : le rembourrage va sur la <nav>,
     * la hauteur sur la grille intérieure. La barre grandit.
     *
     * Le plancher de 9 px du rembourrage disparaît : il ne servait qu'à
     * compenser ce rognage. Sans lui, la barre fait exactement `height` sur le
     * web (où `env()` vaut 0) — aucun changement — et `height + inset` dans
     * l'app.
     */
    <nav
      aria-label={ariaLabel}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--d-line)] bg-[var(--d-surface)] pb-[env(safe-area-inset-bottom)]"
    >
      <div
        className="grid"
        style={{
          height,
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((tab) => {
          const Icon = tab.icon;
          const active = tab.exact
            ? pathname === tab.href
            : [tab.href, ...(tab.match ?? [])].some((p) =>
                pathname.startsWith(p)
              );
          return (
            <Link
              key={tab.href}
              href={tab.href}
              // prefetch complet : routes dynamiques (gate dans la coque) — sans
              // ce flag, chaque tap attendrait un aller-retour serveur.
              prefetch
              className="flex flex-col items-center justify-center gap-[3px] text-[10px] font-semibold whitespace-nowrap"
              style={{ color: active ? BRAND_VIOLET : "var(--d-muted)" }}
            >
              <Icon className="size-[22px]" />
              {isAr ? tab.labelAr : tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ─────────────────────────── En-tête avec retour ─────────────────────────── */

/**
 * En-tête de page secondaire : bouton retour (href ou router.back) + titre
 * Sora + sous-titre optionnel + action à droite.
 */
export function PartnerBackHeader({
  title,
  subtitle,
  href,
  trailing,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Si fourni : Link vers cette route ; sinon retour à l'écran précédent. */
  href?: string;
  trailing?: React.ReactNode;
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const back =
    "grid size-[42px] shrink-0 place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow";
  return (
    <div className="mb-4 flex items-center gap-3">
      {href ? (
        <Link
          href={href}
          aria-label={isAr ? "رجوع" : "Retour"}
          className={back}
        >
          <ChevronLeft className="size-5 rtl:rotate-180" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={isAr ? "رجوع" : "Retour"}
          className={back}
        >
          <ChevronLeft className="size-5 rtl:rotate-180" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1
          className="truncate text-[19px] font-extrabold tracking-[-0.4px] text-[var(--d-ink)]"
          style={{ fontFamily: SORA }}
        >
          {title}
        </h1>
        {subtitle != null && (
          <p className="truncate text-[12px] font-medium text-[var(--d-muted)]">
            {subtitle}
          </p>
        )}
      </div>
      {trailing}
    </div>
  );
}

/* ─────────────────────────── Segmenté (période…) ─────────────────────────── */

export function PartnerSegmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="flex gap-[3px] rounded-[14px] bg-[var(--d-soft)] p-1">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className="flex-1 rounded-[11px] p-2 text-[12.5px] font-bold transition-colors"
            style={
              on
                ? {
                    background: "var(--d-surface)",
                    color: "var(--d-ink)",
                    boxShadow: "0 4px 12px -6px rgba(0,0,0,.25)",
                  }
                : { color: "var(--d-muted)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Tuiles de stats ─────────────────────────── */

export function PartnerStatTiles({
  tiles,
}: {
  tiles: readonly { value: React.ReactNode; label: React.ReactNode }[];
}) {
  return (
    <div
      className="grid gap-2.5"
      style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0,1fr))` }}
    >
      {tiles.map((t, i) => (
        <div
          key={i}
          className="rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] px-2 py-3 text-center"
        >
          <div
            className="text-[18px] font-extrabold tracking-[-0.5px] text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {t.value}
          </div>
          <div className="mt-0.5 text-[10.5px] font-semibold text-[var(--d-muted)]">
            {t.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── Menu (groupe + lignes) ─────────────────────────── */

/**
 * Groupe de lignes façon « Compte chauffeur » (Section) : titre discret +
 * liste bordée. MÊME rendu dans les deux espaces (parité maquette).
 */
export function PartnerMenuGroup({
  title,
  children,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      {title != null && (
        <p className="mb-1.5 px-1 text-[11px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
          {title}
        </p>
      )}
      <div className="overflow-hidden rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)]">
        {children}
      </div>
    </div>
  );
}

/**
 * Ligne de menu façon « Compte chauffeur » (Row) : icône carrée à gauche,
 * libellé, valeur à droite (tronquée) + chevron si actionnable. `trailing`
 * remplace la zone droite (ex. interrupteur).
 */
export function PartnerMenuRow({
  icon,
  label,
  sublabel,
  value,
  chevron,
  href,
  onClick,
  danger,
  trailing,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  value?: React.ReactNode;
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
}) {
  const ink = danger ? BRAND_RED : "var(--d-ink)";
  const actionable = Boolean(href || onClick);
  const content = (
    <>
      {icon != null && (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]"
          style={{ color: danger ? BRAND_RED : undefined }}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate" style={{ color: ink }}>
          {label}
        </span>
        {sublabel != null && (
          <span className="block truncate text-[11.5px] font-medium text-[var(--d-muted)]">
            {sublabel}
          </span>
        )}
      </span>
      {trailing ?? (
        <>
          {value != null && (
            <span className="max-w-[50%] truncate text-right text-xs font-medium text-[var(--d-muted)] rtl:text-left">
              {value}
            </span>
          )}
          {(chevron ?? actionable) && (
            <ChevronRight className="size-4 shrink-0 text-[var(--d-muted)] opacity-70 rtl:rotate-180" />
          )}
        </>
      )}
    </>
  );
  const cls =
    "flex w-full items-center gap-3 border-b border-[var(--d-line)] px-3.5 py-3.5 text-start text-[13.5px] font-semibold last:border-b-0";
  if (href) {
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={cls}>{content}</div>;
}

/** Chip de statut de compte (Vérifié / En vérification / Refusé…). */
export function PartnerStatusChip({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "pending" | "rejected";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const style =
    tone === "ok"
      ? { background: "rgba(22,179,100,.12)", color: BRAND_GO }
      : tone === "rejected"
        ? { background: "rgba(229,72,77,.12)", color: BRAND_RED }
        : { background: "var(--d-accent)", color: BRAND_VIOLET };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold"
      style={style}
    >
      {icon}
      {children}
    </span>
  );
}

/* ─────────────────────────── Badges de statut ─────────────────────────── */

const BADGE_TONES = {
  ok: { background: "rgba(22,179,100,.12)", color: BRAND_GO },
  ko: { background: "rgba(229,72,77,.12)", color: BRAND_RED },
  violet: { background: "rgba(108,43,217,.12)", color: BRAND_VIOLET },
  amber: { background: "rgba(245,158,11,.14)", color: "#c2790a" },
  muted: { background: "var(--d-soft)", color: "var(--d-muted)" },
} as const;

export function PartnerBadge({
  tone = "muted",
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[20px] px-2 py-[3px] text-[10.5px] font-bold whitespace-nowrap"
      style={BADGE_TONES[tone]}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────── Carte héro (dégradé violet) ─────────────────────────── */

/** Carte « montant clé » (relevé, à reverser, gains tournée…) — net-card. */
export function PartnerHeroCard({
  label,
  value,
  sub,
  children,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[22px] p-5 text-white"
      style={{
        background: `linear-gradient(135deg, ${BRAND_VIOLET}, ${BRAND_VIOLET_D})`,
        boxShadow: "0 18px 40px -14px rgba(108,43,217,.45)",
      }}
    >
      <div className="text-[12.5px] font-semibold opacity-85">{label}</div>
      <div
        className="mt-1.5 mb-1 text-[32px] leading-none font-extrabold tracking-[-1px]"
        style={{ fontFamily: SORA }}
      >
        {value}
      </div>
      {sub != null && <div className="text-[12px] opacity-90">{sub}</div>}
      {children}
    </div>
  );
}

/* ─────────────────────────── Divers ─────────────────────────── */

/** Message d'erreur INLINE (règle produit : pas de toast pour les actions). */
/**
 * Ligne « Se déconnecter » PARTAGÉE livreur/chauffeur — même retour visuel
 * que le compte client : au clic le bouton passe TOUT DE SUITE en pending
 * (« Déconnexion en cours… », spinner) ; en cas de succès l'écran est démonté
 * par la redirection serveur (on laisse le pending), sinon erreur INLINE.
 * `onLogout` fait les pré-contrôles de l'espace et renvoie un message
 * d'erreur affichable, ou null si la déconnexion part.
 */
export function PartnerLogoutRow({
  label,
  pendingLabel,
  onLogout,
}: {
  label?: string;
  pendingLabel?: string;
  onLogout: () => Promise<string | null>;
}) {
  const isAr = useLocale() === "ar";
  const shownLabel = label ?? (isAr ? "تسجيل الخروج" : "Se déconnecter");
  const shownPending =
    pendingLabel ?? (isAr ? "جارٍ تسجيل الخروج…" : "Déconnexion en cours…");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (pending) return;
          setErr(null);
          setPending(true);
          void onLogout()
            .then((e) => {
              if (e) {
                setErr(e);
                setPending(false);
              }
            })
            .catch(() => {
              setErr(
                isAr
                  ? "فشل تسجيل الخروج. أعد المحاولة."
                  : "Échec de la déconnexion. Réessayez."
              );
              setPending(false);
            });
        }}
        className="mt-3 flex w-full items-center gap-3 rounded-[16px] border border-[var(--d-line)] px-3.5 py-3.5 text-start text-[13.5px] font-semibold disabled:opacity-70"
        style={{ color: BRAND_RED }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
          {pending ? (
            <Loader2
              className="size-4 animate-spin"
              style={{ color: BRAND_RED }}
            />
          ) : (
            <LogOut className="size-4" style={{ color: BRAND_RED }} />
          )}
        </span>
        {pending ? shownPending : shownLabel}
      </button>
      {err && (
        <div className="mt-2">
          <PartnerInlineError>{err}</PartnerInlineError>
        </div>
      )}
    </>
  );
}

export function PartnerInlineError({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <p
      className="rounded-[12px] px-3 py-2 text-center text-[12px] font-bold"
      style={{ background: "rgba(229,72,77,.1)", color: BRAND_RED }}
    >
      {children}
    </p>
  );
}

/** Barre de progression fine (arrêts livrés, encours / plafond…). */
export function PartnerProgress({
  value,
  max,
  tone = BRAND_VIOLET,
}: {
  value: number;
  max: number;
  tone?: string;
}) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--d-line)]">
      <i
        className="block h-full rounded-full transition-[width]"
        style={{ width: `${Math.max(2, pct)}%`, background: tone }}
      />
    </div>
  );
}

/** État vide illustré (liste sans contenu). */
export function PartnerEmptyState({
  icon,
  title,
  text,
}: {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  text: React.ReactNode;
}) {
  return (
    <div className="rounded-[18px] border border-[var(--d-line)] bg-[var(--d-soft)] px-4 py-8 text-center">
      {icon != null && (
        <span
          className="mx-auto mb-2.5 grid size-11 place-items-center rounded-full bg-[var(--d-surface)] shadow-sm"
          style={{ color: BRAND_VIOLET }}
        >
          {icon}
        </span>
      )}
      {title != null && (
        <p
          className="mb-1 text-[15px] font-extrabold text-[var(--d-ink)]"
          style={{ fontFamily: SORA }}
        >
          {title}
        </p>
      )}
      <p className="text-[13px] font-medium text-[var(--d-muted)]">{text}</p>
    </div>
  );
}
