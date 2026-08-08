"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
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
          className="rounded-card-lg flex gap-1 border border-[var(--d-line)] bg-[var(--d-soft)] p-1"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              onClick={() => setActive(t.id)}
              className={`rounded-control-lg text-label-lg flex-1 items-center justify-center py-2 font-bold transition-colors ${
                active === t.id
                  ? "bg-[var(--d-surface)] text-[var(--d-ink)] shadow-sm"
                  : "text-[var(--d-muted)]"
              }`}
              style={{ fontFamily: SORA }}
            >
              {t.label}
              {t.badge ? (
                <span
                  className="text-micro-lg ms-1.5 rounded-full bg-[var(--d-accent)] px-1.5 py-0.5 font-extrabold tabular-nums"
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
  { label: string; labelAr: string; tone: "ok" | "violet" | "muted" | "ko" }
> = {
  active: { label: "Actif", labelAr: "نشط", tone: "ok" },
  paid: { label: "Payé", labelAr: "مدفوع", tone: "ok" },
  approved: { label: "Payé", labelAr: "مدفوع", tone: "ok" },
  confirmed: { label: "Payé", labelAr: "مدفوع", tone: "ok" },
  pending: { label: "En attente", labelAr: "في الانتظار", tone: "violet" },
  expired: { label: "Expiré", labelAr: "منتهٍ", tone: "muted" },
  cancelled: { label: "Annulé", labelAr: "ملغى", tone: "ko" },
  rejected: { label: "Refusé", labelAr: "مرفوض", tone: "ko" },
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
  const isAr = useLocale() === "ar";
  if (rows.length === 0) {
    if (!emptyText) return null;
    return (
      <p className="text-label-lg rounded-lg border border-[var(--d-line)] bg-[var(--d-surface)] px-3.5 py-4 text-center text-[var(--d-muted)]">
        {emptyText}
      </p>
    );
  }
  const last = rows[0];
  const lastMeta = STATUS_META[last.status] ?? {
    label: last.status,
    labelAr: last.status,
    tone: "muted" as const,
  };
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--d-line)] bg-[var(--d-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-start"
      >
        <span className="min-w-0 flex-1">
          <b
            className="text-body-sm block text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {isAr ? "سجل الاشتراكات" : "Historique des abonnements"}
          </b>
          <span className="text-caption-lg block truncate text-[var(--d-muted)]">
            {rows.length}{" "}
            {isAr ? "عملية" : `opération${rows.length > 1 ? "s" : ""}`}
            {!open ? ` · ${isAr ? "الأخيرة:" : "dernier :"} ${last.title}` : ""}
          </span>
        </span>
        {!open && (
          <PartnerBadge tone={lastMeta.tone}>
            {isAr ? lastMeta.labelAr : lastMeta.label}
          </PartnerBadge>
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
            labelAr: r.status,
            tone: "muted" as const,
          };
          return (
            <div
              key={r.id}
              className="flex items-center gap-3 border-t border-[var(--d-line)] px-3.5 py-3"
            >
              <span className="min-w-0 flex-1">
                <b className="text-body block truncate font-semibold text-[var(--d-ink)] tabular-nums">
                  {r.title}
                </b>
                <span className="text-caption-lg block truncate text-[var(--d-muted)]">
                  {r.sub}
                </span>
              </span>
              <PartnerBadge tone={meta.tone}>
                {isAr ? meta.labelAr : meta.label}
              </PartnerBadge>
            </div>
          );
        })}
    </div>
  );
}
