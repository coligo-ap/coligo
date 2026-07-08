"use client";

import { useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  CreditCard,
  Crown,
  Landmark,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  BRAND_VIOLET,
  BRAND_VIOLET_D,
  PartnerBadge,
  SORA,
} from "@/components/shared/partner-ui";

/**
 * UI PARTAGÉE de la page « Abonnement & Pass » (livreur ET chauffeur) —
 * mêmes composants, seules les DONNÉES changent selon l'espace :
 *  - SubsHero : héro dégradé compact qui « vend » l'offre ;
 *  - BenefitsCarousel : carrousel d'avantages (scroll-snap natif, moderne
 *    et léger — pas de lib) ;
 *  - PayMethodsRow : réassurance moyens de paiement (Coligo Pay · carte · CCP) ;
 *  - SubsHistory : historique unifié des souscriptions (badges statut).
 */

/* ─────────────────────────── Héro ─────────────────────────── */

export function SubsHero({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[18px] p-4 text-white"
      style={{
        background: `linear-gradient(135deg, ${BRAND_VIOLET}, ${BRAND_VIOLET_D})`,
      }}
    >
      {/* Halo décoratif */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 size-36 rounded-full"
        style={{ background: "rgba(255,255,255,.08)" }}
      />
      <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.5px] uppercase opacity-90">
        <Sparkles className="size-3.5" />
        Coligo
      </div>
      <h2
        className="mt-1 text-[19px] leading-tight font-extrabold tracking-[-0.4px]"
        style={{ fontFamily: SORA }}
      >
        {title}
      </h2>
      <p className="mt-1 text-[12.5px] leading-snug opacity-90">{subtitle}</p>
    </div>
  );
}

/* ─────────────────────── Carrousel d'avantages ─────────────────────── */

/**
 * ⚠️ FRONTIÈRE RSC : les pages abonnement sont des Server Components — on ne
 * peut PAS leur faire passer une fonction composant (icône Lucide) en prop
 * (« Functions cannot be passed to Client Components », crash runtime que le
 * build ne voit pas). L'icône est donc une CLÉ sérialisable, résolue ICI.
 */
const BENEFIT_ICONS = {
  zap: Zap,
  crown: Crown,
  badge: BadgeCheck,
  shield: ShieldCheck,
  wallet: Wallet,
} satisfies Record<string, LucideIcon>;

export type Benefit = {
  icon: keyof typeof BENEFIT_ICONS;
  title: string;
  text: string;
};

export function BenefitsCarousel({ items }: { items: readonly Benefit[] }) {
  // Grille 2 colonnes COMPACTE (plus de carrousel horizontal : tout est
  // visible d'un coup d'œil, hauteur divisée par deux, aucun scroll caché).
  return (
    <div className="grid grid-cols-2 gap-2" role="list">
      {items.map((b, i) => {
        const Icon = BENEFIT_ICONS[b.icon];
        return (
          <div
            key={i}
            role="listitem"
            className="rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3"
          >
            <span className="mb-1.5 flex items-center gap-1.5">
              <Icon
                className="size-4 shrink-0"
                style={{ color: BRAND_VIOLET }}
              />
              <b
                className="truncate text-[12.5px] text-[var(--d-ink)]"
                style={{ fontFamily: SORA }}
              >
                {b.title}
              </b>
            </span>
            <span className="block text-[11px] leading-snug text-[var(--d-muted)]">
              {b.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────── Réassurance moyens de paiement ─────────────────── */

const PAY_METHODS = [
  { icon: Wallet, label: "Coligo Pay", sub: "instantané" },
  { icon: CreditCard, label: "CIB / Edahabia", sub: "en ligne" },
  { icon: Landmark, label: "CCP / BaridiMob", sub: "virement" },
] as const;

export function PayMethodsRow() {
  return (
    <div className="rounded-[16px] border border-[var(--d-line)] bg-[var(--d-soft)] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
        <ShieldCheck className="size-3.5" />
        Paiement sécurisé
      </p>
      <div className="grid grid-cols-3 gap-2">
        {PAY_METHODS.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.label}
              className="flex flex-col items-center gap-1 rounded-[12px] bg-[var(--d-surface)] px-1 py-2 text-center"
            >
              <Icon className="size-4" style={{ color: BRAND_VIOLET }} />
              <b className="text-[10.5px] leading-tight text-[var(--d-ink)]">
                {m.label}
              </b>
              <span className="text-[9.5px] text-[var(--d-muted)]">
                {m.sub}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Historique ─────────────────────────── */

export type SubsHistoryRow = {
  id: string;
  /** Ligne 1 : « Pass Prioritaire · 400 DA ». */
  title: string;
  /** Ligne 2 : « 01 juil. → 01 août · Coligo Pay ». */
  sub: string;
  status: string;
};

const STATUS_META: Record<
  string,
  { label: string; tone: "ok" | "violet" | "muted" | "ko" }
> = {
  active: { label: "Actif", tone: "ok" },
  paid: { label: "Payé", tone: "ok" },
  approved: { label: "Payé", tone: "ok" },
  confirmed: { label: "Payé", tone: "ok" },
  pending: { label: "En attente", tone: "violet" },
  expired: { label: "Expiré", tone: "muted" },
  cancelled: { label: "Annulé", tone: "ko" },
  rejected: { label: "Refusé", tone: "ko" },
};

export function SubsHistory({ rows }: { rows: SubsHistoryRow[] }) {
  // Section DÉPLIANTE : fermée par défaut (la page reste courte), le compteur
  // et le dernier statut suffisent d'un coup d'œil. Ouverte d'office si un
  // paiement est en attente (l'info importante ne doit pas être cachée).
  const hasPending = rows.some((r) => r.status === "pending");
  const [open, setOpen] = useState(hasPending);
  if (rows.length === 0) return null;
  const last = rows[0];
  const lastMeta = STATUS_META[last.status] ?? {
    label: last.status,
    tone: "muted" as const,
  };
  return (
    <div className="overflow-hidden rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <b
            className="block text-[13px] text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            Historique des abonnements
          </b>
          <span className="block truncate text-[11.5px] text-[var(--d-muted)]">
            {rows.length} opération{rows.length > 1 ? "s" : ""}
            {!open ? ` · dernier : ${last.title}` : ""}
          </span>
        </span>
        {!open && (
          <PartnerBadge tone={lastMeta.tone}>{lastMeta.label}</PartnerBadge>
        )}
        <ChevronDown
          className="size-4 shrink-0 text-[var(--d-muted)] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      {open &&
        rows.map((r) => {
          const meta = STATUS_META[r.status] ?? {
            label: r.status,
            tone: "muted" as const,
          };
          return (
            <div
              key={r.id}
              className="flex items-center gap-3 border-t border-[var(--d-line)] px-3.5 py-3"
            >
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13.5px] font-semibold text-[var(--d-ink)] tabular-nums">
                  {r.title}
                </b>
                <span className="block truncate text-[11.5px] text-[var(--d-muted)]">
                  {r.sub}
                </span>
              </span>
              <PartnerBadge tone={meta.tone}>{meta.label}</PartnerBadge>
            </div>
          );
        })}
    </div>
  );
}
