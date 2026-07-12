"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Check, HandCoins, Star, Zap } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  clearNavPref,
  getNavPref,
  NAV_APPS,
  openNav,
  setNavPref,
} from "@/lib/drive/nav";
import {
  GhostBtn,
  PrimaryBtn,
  Sheet,
  SheetTitle,
  ReportModal,
  GO,
  RED,
  VIOLET,
} from "@/components/customer/drive/drive-modals";
import { fmtPct } from "./d-ui";
import {
  getChauffeurLastDone,
  rateClientAction,
  reportClientAction,
  type B2BNext,
} from "@/app/(chauffeur)/actions";

/* ════════ Sélecteur d'application GPS (Google Maps / Waze / Plans) ════════ */

export function NavAppSheet({
  target,
  onClose,
}: {
  target: { lat: number; lng: number; label: string } | null;
  onClose: () => void;
}) {
  const [remember, setRemember] = useState(true);
  if (!target) return null;
  const pref = getNavPref();
  return (
    <Sheet open onClose={onClose}>
      <SheetTitle>Itinéraire vers {target.label}</SheetTitle>
      <p className="mb-3 text-[13px] text-[var(--d-muted)]">
        Choisissez votre application GPS — l&apos;itinéraire s&apos;ouvre
        directement.
      </p>
      <div className="space-y-2">
        {NAV_APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              if (remember) setNavPref(a.id);
              openNav(a.id, target.lat, target.lng);
              onClose();
            }}
            className="flex h-[52px] w-full items-center gap-3 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] px-4 text-[14px] font-bold"
          >
            <span className="text-xl">{a.emoji}</span> {a.label}
            <span className="ml-auto text-[var(--d-muted)]">›</span>
          </button>
        ))}
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-[var(--d-muted)]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="size-4"
          style={{ accentColor: VIOLET }}
        />
        Se souvenir de mon choix
      </label>
      {pref && (
        <button
          type="button"
          onClick={() => {
            clearNavPref();
            onClose();
          }}
          className="mt-1 block w-full text-center text-[12px] font-bold"
          style={{ color: VIOLET }}
        >
          Réinitialiser l&apos;application par défaut
        </button>
      )}
      <GhostBtn onClick={onClose}>Annuler</GhostBtn>
    </Sheet>
  );
}

/* NB : le chat de course (ex-DChat) vit désormais dans
   `components/drive/ride-chat-sheet.tsx` — feuille plein écran PARTAGÉE avec
   le client (accusés Lu, temps réel, réponses rapides). */

/* ════════ Fin de course (s-ddone) ════════ */

const RATE_LABELS = ["Décevant", "Moyen", "Correct", "Très bien", "Excellent"];

export function DoneScreen({
  done,
  queued,
  onChainQueued,
  onRequests,
  onHome,
}: {
  done: NonNullable<Awaited<ReturnType<typeof getChauffeurLastDone>>>;
  queued: B2BNext | null;
  onChainQueued: () => Promise<void>;
  onRequests: () => void;
  onHome: () => void;
}) {
  const [rating, setRating] = useState(done.my_rating ?? 0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState<string | null>(null);
  const pct = done.commission_rate != null ? fmtPct(done.commission_rate) : "—";

  // Pourboire (mig 0363) : peut TOMBER APRÈS la fin (le client note puis donne)
  // → on écoute la course en Realtime et la ligne apparaît en direct.
  const [tip, setTip] = useState(done.tip_da);
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`done-tip-${done.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rides",
          filter: `id=eq.${done.id}`,
        },
        (payload) => {
          const next = (payload.new as { tip_da?: number }).tip_da ?? 0;
          if (next > 0) setTip(next);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [done.id]);

  return (
    <div className="drive-jakarta drive-screen overflow-y-auto bg-[var(--d-page)] pb-8">
      {/* ── Héro : gain net d'un coup d'œil ── */}
      <div className="rounded-b-[28px] bg-[var(--d-surface)] px-5 pt-9 pb-6 text-center shadow-[0_18px_40px_-28px_rgba(20,22,40,.35)]">
        <span
          className="drive-pop mx-auto mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(22,179,100,.12)" }}
        >
          <Check className="size-7" style={{ color: GO }} />
        </span>
        <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
          Course terminée
        </h1>
        <p
          className="drive-sora mt-1 text-[36px] leading-none font-extrabold tracking-[-1px]"
          style={{ color: GO }}
        >
          +{formatDA(done.net_da + tip)}
        </p>
        <p className="mt-1.5 text-[12px] font-semibold text-[var(--d-muted)]">
          {done.pickup_text ?? "—"} → {done.dest_text ?? "—"}
        </p>
      </div>

      <div className="px-5">
        {/* ── Pourboire reçu (apparaît en DIRECT si le client en laisse un) ── */}
        {tip > 0 && (
          <div
            className="drive-up mt-3 flex items-center gap-3 rounded-[16px] p-3"
            style={{ background: "rgba(22,179,100,.12)" }}
          >
            <span className="drive-pop grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
              <HandCoins className="size-5" style={{ color: GO }} />
            </span>
            <b className="text-[13.5px]" style={{ color: GO }}>
              Pourboire du client · +{formatDA(tip)}
            </b>
          </div>
        )}

        {/* ── Détail du gain ── */}
        <div className="drive-rise mt-3 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] px-4 py-1.5">
          <div className="flex items-center justify-between py-2 text-[13.5px]">
            <span className="text-[var(--d-muted)]">Prix de la course</span>
            <span>{formatDA(done.price_da)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--d-line)] py-2 text-[13.5px]">
            <span className="text-[var(--d-muted)]">
              Commission Coligo ({pct})
            </span>
            <span style={{ color: RED }}>−{formatDA(done.commission_da)}</span>
          </div>
          {tip > 0 && (
            <div className="flex items-center justify-between border-t border-[var(--d-line)] py-2 text-[13.5px]">
              <span className="text-[var(--d-muted)]">Pourboire</span>
              <span style={{ color: GO }}>+{formatDA(tip)}</span>
            </div>
          )}
        </div>

        {/* ── Encaissement ── */}
        <div
          className="drive-rise mt-2.5 flex items-center gap-3 rounded-[16px] p-3"
          style={{ background: "rgba(22,179,100,.12)", animationDelay: ".05s" }}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
            <BadgeCheck className="size-5" style={{ color: GO }} />
          </span>
          <span>
            <b className="block text-[13.5px]" style={{ color: GO }}>
              {done.payment_method === "cash"
                ? "Espèces encaissées auprès du client"
                : done.cash_due_da > 0
                  ? `${formatDA(done.cash_due_da)} encaissés en espèces · ${formatDA(done.price_da - done.cash_due_da)} via Coligo Pay, crédités sur votre solde`
                  : "Prépayée · encaissée par Coligo, créditée sur votre solde"}
            </b>
            {done.commission_da > 0 && (
              <span className="text-[11px] text-[var(--d-muted)]">
                Avec Premium (0 %), vous auriez gardé{" "}
                <b>{formatDA(done.price_da)}</b>
              </span>
            )}
          </span>
        </div>

        {queued && (
          <div
            className="drive-rise mt-2.5 flex items-center gap-3 rounded-[16px] p-3"
            style={{ background: "var(--d-accent)", animationDelay: ".1s" }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
              <Zap className="size-4.5" style={{ color: VIOLET }} />
            </span>
            <span>
              <b className="block text-[13.5px]" style={{ color: VIOLET }}>
                Course suivante : {queued.customer_name} ·{" "}
                {queued.proposed_price_da + queued.boost_amount_da} DA
              </b>
              <span className="text-[11px] text-[var(--d-muted)]">
                À{" "}
                {`${(Math.round(queued.pickup_dist_km * 10) / 10).toString().replace(".", ",")} km`}{" "}
                · le client vous attend
              </span>
            </span>
          </div>
        )}

        {/* ── Notation du client (étoiles + libellé) ── */}
        <div
          className="drive-rise mt-2.5 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4"
          style={{ animationDelay: ".15s" }}
        >
          <p className="mb-1.5 text-center text-[13px] font-semibold">
            Notez le client
          </p>
          <div className="flex justify-center gap-2.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={RATE_LABELS[n - 1]}
                className="transition-transform active:scale-90"
                onClick={async () => {
                  setRating(n);
                  await rateClientAction(done.id, n);
                }}
              >
                <Star
                  className={n <= rating ? "drive-pop size-9" : "size-9"}
                  style={{
                    color: "#E8B53C",
                    fill: n <= rating ? "#E8B53C" : "transparent",
                  }}
                />
              </button>
            ))}
          </div>
          <p
            className="mt-1.5 h-4 text-center text-[11.5px] font-bold"
            style={{ color: rating > 0 ? "#B45309" : "var(--d-muted)" }}
          >
            {rating > 0 ? RATE_LABELS[rating - 1] : " "}
          </p>
        </div>

        {reported ? (
          <div
            className="mt-3 mb-1 flex items-start gap-2 rounded-[13px] px-3 py-2.5 text-[11.5px] leading-relaxed font-semibold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            <BadgeCheck className="mt-0.5 size-4 shrink-0" />
            Signalement transmis (« {reported} »). Examen sous 24 h — le client
            peut être suspendu. Vous serez informé de la décision.
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="mt-3 mb-1 block w-full text-center text-[12.5px] font-bold"
            style={{ color: RED }}
          >
            Signaler un problème avec ce client
          </button>
        )}

        <PrimaryBtn onClick={queued ? () => void onChainQueued() : onRequests}>
          {queued
            ? `Enchaîner · aller chercher ${queued.customer_name}`
            : "Voir les demandes suivantes"}
        </PrimaryBtn>
        <GhostBtn onClick={onHome}>Retour à l&apos;accueil</GhostBtn>
      </div>

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        side="driver"
        onConfirm={async (reason) => {
          setReportOpen(false);
          await reportClientAction(done.id, reason);
          setReported(reason);
        }}
      />
    </div>
  );
}
