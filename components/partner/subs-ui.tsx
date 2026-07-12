"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  BRAND_VIOLET,
  PartnerBadge,
  SORA,
} from "@/components/shared/partner-ui";

/**
 * UI PARTAGÉE de la page « Abonnement & Pass » (livreur ET chauffeur) —
 * style Bolt STRICT : les avantages et le paiement vivent SUR les cartes
 * d'offre (PriorityCard / PlanCard), jamais répétés ailleurs.
 *  - SubsTabs : nav sous-page segmentée (Offres · Historique) — panneaux
 *    MONTÉS en permanence (l'inactif en `hidden`, cf. règle CLAUDE.md
 *    « écran chargé → sous-pages ») ;
 *  - SubsHistory : historique unifié des souscriptions (badges statut).
 * (Héro marketing, grille d'avantages et réassurance paiement SUPPRIMÉS :
 * ils dupliquaient les cartes d'offre — règle « zéro doublon ».)
 */

/* ─────────────────────── Nav sous-page segmentée ─────────────────────── */

export type SubsTab = {
  id: string;
  label: string;
  badge?: number;
  content: React.ReactNode;
};

export function SubsTabs({
  tabs,
  navClassName,
}: {
  tabs: SubsTab[];
  /** Conteneur de la barre (ex. "mx-auto max-w-[560px] px-4"). */
  navClassName?: string;
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <div>
      {/* Fondu doux à chaque (ré)activation d'un panneau. */}
      <style>{`@keyframes subsFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.subs-panel{animation:subsFade .18s ease}`}</style>
      <div className={navClassName}>
        <div
          role="tablist"
          className="flex gap-1 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] p-1"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              onClick={() => setActive(t.id)}
              className={`flex-1 items-center justify-center rounded-[11px] py-2 text-[12.5px] font-bold transition-colors ${
                active === t.id
                  ? "bg-[var(--d-surface)] text-[var(--d-ink)] shadow-sm"
                  : "text-[var(--d-muted)]"
              }`}
              style={{ fontFamily: SORA }}
            >
              {t.label}
              {t.badge ? (
                <span
                  className="ms-1.5 rounded-full bg-[var(--d-accent)] px-1.5 py-0.5 text-[10.5px] font-extrabold tabular-nums"
                  style={{ color: BRAND_VIOLET }}
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      {/* Panneaux MONTÉS en permanence : état (paiement, poll carte) préservé. */}
      {tabs.map((t) => (
        <div key={t.id} className={active === t.id ? "subs-panel" : "hidden"}>
          {t.content}
        </div>
      ))}
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

export function SubsHistory({
  rows,
  defaultOpen = false,
  emptyText,
}: {
  rows: SubsHistoryRow[];
  /** Ouvert d'emblée (onglet Historique dédié). */
  defaultOpen?: boolean;
  /** Affiché quand il n'y a aucune opération (sinon le composant disparaît). */
  emptyText?: string;
}) {
  // Section DÉPLIANTE : fermée par défaut (la page reste courte), le compteur
  // et le dernier statut suffisent d'un coup d'œil. Ouverte d'office si un
  // paiement est en attente (l'info importante ne doit pas être cachée).
  const hasPending = rows.some((r) => r.status === "pending");
  const [open, setOpen] = useState(defaultOpen || hasPending);
  if (rows.length === 0) {
    if (!emptyText) return null;
    return (
      <p className="rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] px-3.5 py-4 text-center text-[12.5px] text-[var(--d-muted)]">
        {emptyText}
      </p>
    );
  }
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
