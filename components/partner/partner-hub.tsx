"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  BadgeCheck,
  ChevronRight,
  Clock,
  FileText,
  Gift,
  HandCoins,
  Info,
  ListOrdered,
  LogOut,
  Send,
  Store,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { DossierSection } from "@/components/partner/dossier-section";
import {
  getPartnerStats,
  partnerLogout,
  type PartnerStats,
} from "@/app/(partner)/actions";

// =============================================================================
// ACCUEIL AGENT COLIGO PAY — un HUB, plus un empilement.
//
// Avant : une seule page interminable qui enchaînait solde, aide, PIN, vente,
// module de recharge (1 000 lignes), historique et dossier. L'agent devait
// faire défiler pour atteindre le geste qu'il répète vingt fois par jour.
//
// Maintenant : le solde et l'état du compte en haut — ce qu'on vient vérifier
// d'un coup d'œil — puis des ENTRÉES vers des sous-pages dédiées. Chaque geste
// a son écran, et chaque écran ne charge que ce qui le concerne.
// =============================================================================

export function PartnerHub({
  walletId,
  displayName,
  status,
  isVerified,
  rejectedReason,
  address,
  phone,
}: {
  walletId: string;
  displayName: string;
  status: "active" | "suspended" | "disabled" | "pending" | "rejected";
  isVerified: boolean;
  rejectedReason: string | null;
  address: string | null;
  phone: string | null;
}) {
  const isActive = status === "active";
  const [stats, setStats] = useState<PartnerStats | null>(null);

  useEffect(() => {
    void getPartnerStats().then(setStats);
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      {/* ===== HERO ===== */}
      <div className="border-border relative overflow-hidden rounded-[20px] border bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="bg-primary-50 text-primary-700 flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <Store className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-foreground flex items-center gap-1.5 text-[15px] leading-tight font-bold">
                <span className="truncate">{displayName}</span>
                {isVerified && (
                  <BadgeCheck
                    className="text-success-600 size-4 shrink-0"
                    aria-label="Vérifié"
                  />
                )}
              </p>
              <p className="text-muted truncate text-xs">
                {address ?? "Agent Coligo Pay"}
              </p>
            </div>
          </div>
          <form action={partnerLogout}>
            <button
              type="submit"
              className="border-border text-muted hover:bg-surface-2 flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
            >
              <LogOut className="size-3.5" /> Quitter
            </button>
          </form>
        </div>

        <p className="text-muted mt-4 text-xs">Solde disponible</p>
        <p className="text-foreground text-3xl font-extrabold tabular-nums">
          {stats ? formatDA(stats.balanceDa) : "…"}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <HeroChip
            icon={<Gift className="size-3.5" />}
            label="Bonus reçus"
            value={stats ? formatDA(stats.totalBonusDa) : "…"}
          />
          <HeroChip
            icon={<Send className="size-3.5" />}
            label="Revendu"
            value={stats ? formatDA(stats.totalSoldDa) : "…"}
          />
          <HeroChip
            icon={<HandCoins className="size-3.5" />}
            label="Ventes"
            value={stats ? String(stats.salesCount) : "…"}
          />
        </div>

        {status === "pending" && (
          <div className="border-warning-200 bg-warning-50 text-warning-800 mt-3 flex items-start gap-2 rounded-[12px] border p-2.5 text-xs font-semibold">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Demande en cours d&apos;examen. Complétez votre dossier ci-dessous
              — Coligo l&apos;active dès validation.
            </span>
          </div>
        )}
        {status === "rejected" && (
          <div className="border-danger-200 bg-danger-50 text-danger-700 mt-3 flex items-start gap-2 rounded-[12px] border p-2.5 text-xs font-semibold">
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Dossier refusé{rejectedReason ? ` : ${rejectedReason}` : ""}.
              Corrigez vos pièces ci-dessous puis renvoyez.
            </span>
          </div>
        )}
        {(status === "suspended" || status === "disabled") && (
          <div className="border-warning-200 bg-warning-50 text-warning-800 mt-3 flex items-start gap-2 rounded-[12px] border p-2.5 text-xs font-semibold">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Compte {status === "suspended" ? "suspendu" : "désactivé"} —
              contactez Coligo pour le réactiver.
            </span>
          </div>
        )}
      </div>

      {/* Dossier (pièces) — prioritaire tant que le compte n'est pas actif :
          rien d'autre ne sert tant qu'il n'est pas validé. */}
      {!isActive && <DossierSection walletId={walletId} />}

      {/* ===== ENTRÉES VERS LES SOUS-PAGES =====
          `prefetch` + `loading.tsx` sur chaque route : le tap ouvre l'écran
          immédiatement, les données arrivent derrière. */}
      {isActive && (
        <nav className="border-border bg-surface overflow-hidden rounded-[16px] border">
          <HubRow
            href="/partenaire/vendre"
            icon={Send}
            title="Vendre du crédit"
            desc="Le client paie en espèces, vous envoyez le crédit"
            accent
          />
          <HubRow
            href="/partenaire/recharger"
            icon={ArrowDownToLine}
            title="Recharger mon crédit"
            desc="Par carte ou par virement / CCP"
          />
          <HubRow
            href="/partenaire/historique"
            icon={ListOrdered}
            title="Historique"
            desc="Ventes, recharges et bonus"
          />
          <HubRow
            href="/partenaire/dossier"
            icon={FileText}
            title="Mon dossier"
            desc="Pièces justificatives"
          />
          <HubRow
            href="/partenaire/aide"
            icon={Info}
            title="Comment ça marche"
            desc="Le métier d'agent en 3 étapes"
            last
          />
        </nav>
      )}

      {phone && (
        <p className="text-subtle text-center text-xs">
          Connecté · {phone.replace(/(\d{4})(\d+)(\d{2})/, "$1•••$3")}
        </p>
      )}
    </div>
  );
}

/** Entrée du hub : une ligne = une sous-page. */
function HubRow({
  href,
  icon: Icon,
  title,
  desc,
  accent,
  last,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch
      className={`hover:bg-surface-2 flex items-center gap-3 px-4 py-3.5 transition-colors ${last ? "" : "border-border border-b"}`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-[11px] ${accent ? "bg-primary-600 text-white" : "bg-primary-50 text-primary-700"}`}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="text-foreground block truncate text-[13.5px] font-bold">
          {title}
        </b>
        <small className="text-muted block truncate text-[11.5px]">
          {desc}
        </small>
      </span>
      <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
    </Link>
  );
}

function HeroChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border bg-surface-2 rounded-[12px] border p-2">
      <span className="text-muted flex items-center gap-1 text-[10px]">
        {icon} {label}
      </span>
      <p className="text-foreground mt-0.5 text-sm font-bold tabular-nums">
        {value}
      </p>
    </div>
  );
}
