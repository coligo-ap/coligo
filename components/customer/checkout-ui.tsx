"use client";

import Link from "next/link";
import {
  Check,
  ChevronRight,
  Coins,
  Gift,
  Info,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Sous-composants visuels (style Uber, accent violet Coligo) ──

/** Bloc premium : ombre douce multi-couche + entrée en cascade (co-rise). */
export function Block({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={cn(
        "border-border co-rise overflow-hidden rounded-[20px] border bg-white",
        className
      )}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  icon: Icon,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-muted flex items-center gap-2 text-[11px] font-extrabold tracking-wider uppercase",
        className
      )}
    >
      <Icon className="text-foreground size-[14px]" />
      {children}
    </h2>
  );
}

/**
 * Option de paiement — CARTE sélectionnable (grille 2 colonnes) avec badge
 * cashback comparatif : le client voit d'un coup d'œil ce que chaque mode
 * lui rapporte (vert = gain, neutre = pas de cashback).
 */
export function PayCard({
  icon: Icon,
  selected,
  onClick,
  title,
  sub,
  chip,
  chipTone,
  bolt,
  disabled,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  selected: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  chip: string;
  chipTone: "success" | "muted";
  bolt?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "relative flex flex-col items-start gap-2 rounded-[20px] border-2 p-3 pt-3.5 text-start transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
        selected
          ? "border-primary-600 bg-primary-50 shadow-[0_10px_24px_-10px_rgba(108,43,217,0.45)]"
          : "border-border bg-surface hover:border-primary-300",
        className
      )}
    >
      {/* Coche de sélection (coin) */}
      <span
        className={cn(
          "absolute end-2.5 top-2.5 grid size-[19px] place-items-center rounded-full transition",
          selected
            ? "bg-primary-600 co-pop text-white"
            : "border-border-strong border-2 bg-white"
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3.5} />}
      </span>

      <span
        className={cn(
          "grid size-[36px] shrink-0 place-items-center rounded-[12px]",
          selected
            ? "text-primary-600 bg-white shadow-[0_3px_8px_-2px_rgba(91,91,230,0.4)]"
            : "bg-surface-2 text-foreground"
        )}
      >
        <Icon className="size-[17px]" />
      </span>

      <span className="min-w-0">
        <span className="text-foreground flex flex-wrap items-center gap-1 text-[12.5px] leading-tight font-extrabold">
          {title}
          {bolt && (
            <span className="grid size-[16px] shrink-0 place-items-center rounded-[6px] bg-gradient-to-br from-[#ffb02e] to-[#c77a18] text-white shadow-[0_2px_5px_rgba(199,122,24,0.4)]">
              <Zap className="size-[9px]" fill="currentColor" />
            </span>
          )}
        </span>
        <span className="text-muted mt-1 block text-[10.5px] leading-snug font-semibold">
          {sub}
        </span>
      </span>

      {/* Badge cashback — rectangle doux (peut passer sur 2 lignes). */}
      <span
        className={cn(
          "mt-auto inline-flex items-start gap-1 rounded-[10px] px-2 py-1 text-[10.5px] leading-snug font-extrabold tabular-nums",
          chipTone === "success"
            ? "bg-success-50 text-success-700"
            : "bg-surface-2 text-subtle"
        )}
      >
        <Gift className="mt-0.5 size-3 shrink-0" />
        <span>{chip}</span>
      </span>
    </button>
  );
}

/** Carte de SOLDE (maquette) : cashback (vert) ou Coligo Pay (violet) —
 *  pastille pleine, « Disponible », montant en gros, TOGGLE d'utilisation,
 *  illustration lucide (jamais d'emoji), bandeau-lien optionnel. REDESIGN
 *  pur : mêmes toggles/conditions que l'ancienne WalletRow. */
export function WalletCard({
  icon: Icon,
  tone,
  title,
  subLabel,
  amountLabel,
  savePillText,
  href,
  checked,
  onToggle,
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: "success" | "primary";
  title: string;
  subLabel: string;
  amountLabel: string;
  /** Bandeau du bas (lien) — omis = pas de bandeau. */
  savePillText?: string;
  href?: string;
  checked: boolean;
  onToggle: () => void;
  delay?: number;
}) {
  const success = tone === "success";
  return (
    <section
      className={cn(
        "co-rise relative overflow-hidden rounded-[20px] p-4",
        success ? "bg-success-50" : "bg-primary-50"
      )}
      style={{ animationDelay: `${delay}s` }}
    >
      {/* Illustration décorative (icône + pièces) — côté opposé au texte. */}
      <span
        aria-hidden
        className="pointer-events-none absolute end-4 top-9 select-none"
      >
        <Icon
          className={cn(
            "size-16 rotate-[8deg]",
            success ? "text-success-500" : "text-primary-400"
          )}
          strokeWidth={1.6}
        />
        <Coins className="absolute -start-4 -bottom-1 size-6 rotate-[-12deg] text-amber-500" />
        <Coins className="absolute -end-2.5 -bottom-2 size-5 rotate-[18deg] text-amber-400" />
        <Sparkles
          className={cn(
            "absolute -end-3 -top-3 size-4",
            success ? "text-success-400" : "text-primary-300"
          )}
        />
      </span>

      <div className="relative flex items-start gap-3">
        <span
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-full text-white",
            success ? "bg-success-500" : "bg-primary-600"
          )}
        >
          <Icon className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-foreground block text-[15.5px] font-extrabold">
            {title}
          </span>
          <span className="text-muted mt-0.5 flex items-center gap-1 text-[12px] font-semibold">
            {subLabel}
            <Info className="size-3.5" />
          </span>
          <span
            className={cn(
              "mt-1 block text-[26px] leading-8 font-extrabold tabular-nums",
              success ? "text-success-600" : "text-primary-700"
            )}
          >
            {amountLabel}
          </span>
        </span>
        {/* Toggle d'utilisation du solde (même comportement qu'avant). */}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={title}
          onClick={onToggle}
          className={cn(
            "relative mt-6 inline-flex h-[30px] w-[52px] shrink-0 items-center rounded-full transition-colors",
            checked
              ? success
                ? "bg-success-500"
                : "bg-primary-600"
              : "bg-border-strong"
          )}
        >
          <span
            className={cn(
              "inline-block size-[24px] transform rounded-full bg-white shadow transition-transform",
              checked
                ? "translate-x-[25px] rtl:-translate-x-[25px]"
                : "translate-x-[3px] rtl:-translate-x-[3px]"
            )}
          />
        </button>
      </div>

      {savePillText && href && (
        <Link
          href={href}
          className={cn(
            "relative mt-3 flex items-center gap-2 rounded-[13px] px-3.5 py-2.5 transition active:scale-[0.99]",
            success ? "bg-success-100/80" : "bg-primary-100/70"
          )}
        >
          <Sparkles
            className={cn(
              "size-4 shrink-0",
              success ? "text-success-600" : "text-primary-600"
            )}
          />
          <span
            className={cn(
              "flex-1 text-[12.5px] leading-snug font-bold",
              success ? "text-success-800" : "text-primary-800"
            )}
          >
            {savePillText}
          </span>
          <ChevronRight
            className={cn(
              "size-4 shrink-0 rtl:rotate-180",
              success ? "text-success-700" : "text-primary-700"
            )}
          />
        </Link>
      )}
    </section>
  );
}

/** Ligne de solde (cashback / Coligo Pay) — switch dans la carte paiement. */
export function WalletRow({
  icon: Icon,
  checked,
  onToggle,
  title,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  checked: boolean;
  onToggle: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition active:scale-[0.99]"
    >
      <span className="text-primary-600 bg-surface-2 grid size-[38px] shrink-0 place-items-center rounded-[11px]">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-[14.5px] font-extrabold">
          {title}
        </span>
        <span className="text-muted block text-[11.5px] font-semibold">
          {sub}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-[27px] w-[46px] shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary-600" : "bg-border-strong"
        )}
      >
        <span
          className={cn(
            "inline-block size-[21px] transform rounded-full bg-white shadow transition-transform",
            // RTL : le curseur démarre du bord DROIT → on inverse la translation.
            checked
              ? "translate-x-[22px] rtl:-translate-x-[22px]"
              : "translate-x-[3px] rtl:-translate-x-[3px]"
          )}
        />
      </span>
    </button>
  );
}

/** Ligne repliable compacte (« Ajouter un code promo › »). */
export function AddLine({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 p-4 text-start transition active:scale-[0.99]"
    >
      <span className="bg-primary-50 text-primary-600 grid size-[34px] shrink-0 place-items-center rounded-[10px]">
        {icon}
      </span>
      <span className="text-foreground flex-1 text-sm font-bold">
        {title}
        {sub && (
          <span className="text-muted mt-0.5 block text-[11.5px] font-semibold">
            {sub}
          </span>
        )}
      </span>
      <ChevronRight className="text-subtle size-4 shrink-0" />
    </button>
  );
}

/** Tuile de choix retrait (Immédiat / Planifier) — même langage visuel que les
 *  tuiles de mode livraison (Express / Tournée) : cohérent et 2× plus compact
 *  que les anciennes lignes radio empilées. */
export function PickupTile({
  checked,
  onClick,
  icon,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-start gap-2 rounded-[12px] border p-3 text-start transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-primary-500 bg-primary-50"
          : "border-border bg-surface hover:border-primary-300"
      )}
    >
      <span
        className={cn("mt-0.5", checked ? "text-primary-600" : "text-muted")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-sm font-semibold">
          {title}
        </span>
        {hint && <span className="text-muted text-xs">{hint}</span>}
      </span>
    </button>
  );
}

/** Petit glyphe calendrier (line icon) pour le créneau programmé. */
export function CalendarGlyph() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M9 3v4M15 3v4" />
    </svg>
  );
}

/** Ligne total en gras (récap). */
export function TotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between pt-0.5">
      <dt className="text-foreground text-[17px] font-extrabold">{label}</dt>
      <dd className="text-foreground text-[17px] font-extrabold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export function RRow({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: "success" | "primary";
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-[3px] text-sm">
      <dt className={muted ? "text-muted" : "text-foreground font-semibold"}>
        {label}
      </dt>
      <dd
        className={cn(
          "font-semibold tabular-nums",
          tone === "success"
            ? "text-success-700 font-extrabold"
            : tone === "primary"
              ? "text-primary-700"
              : muted
                ? "text-foreground"
                : "text-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
