"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  if (!target) return null;
  const pref = getNavPref();
  return (
    <Sheet open onClose={onClose}>
      <SheetTitle>
        {tr("Itinéraire vers", "المسار نحو")} {target.label}
      </SheetTitle>
      <p className="text-body-sm mb-3 text-[var(--d-muted)]">
        {tr(
          "Choisissez votre application GPS — l'itinéraire s'ouvre directement.",
          "اختر تطبيق GPS — يُفتح المسار مباشرة."
        )}
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
            className="rounded-card-lg text-body-lg flex h-[52px] w-full items-center gap-3 border border-[var(--d-line)] bg-[var(--d-surface)] px-4 font-bold"
          >
            <span className="text-xl">{a.emoji}</span> {a.label}
            <span className="ms-auto text-[var(--d-muted)] rtl:-scale-x-100">
              ›
            </span>
          </button>
        ))}
      </div>
      <label className="text-label-lg mt-3 flex cursor-pointer items-center gap-2 font-semibold text-[var(--d-muted)]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="size-4"
          style={{ accentColor: VIOLET }}
        />
        {tr("Se souvenir de mon choix", "تذكّر اختياري")}
      </label>
      {pref && (
        <button
          type="button"
          onClick={() => {
            clearNavPref();
            onClose();
          }}
          className="text-label mt-1 block w-full text-center font-bold"
          style={{ color: VIOLET }}
        >
          {tr(
            "Réinitialiser l'application par défaut",
            "إعادة تعيين التطبيق الافتراضي"
          )}
        </button>
      )}
      <GhostBtn onClick={onClose}>{tr("Annuler", "إلغاء")}</GhostBtn>
    </Sheet>
  );
}

/* NB : le chat de course (ex-DChat) vit désormais dans
   `components/drive/ride-chat-sheet.tsx` — feuille plein écran PARTAGÉE avec
   le client (accusés Lu, temps réel, réponses rapides). */

/* ════════ Fin de course (s-ddone) ════════ */

const RATE_LABELS = ["Décevant", "Moyen", "Correct", "Très bien", "Excellent"];
const RATE_LABELS_AR = ["مخيّب", "متوسط", "مقبول", "جيد جدًا", "ممتاز"];

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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const rateLabels = isAr ? RATE_LABELS_AR : RATE_LABELS;
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
      <div className="rounded-b-2xl bg-[var(--d-surface)] px-5 pt-7 pb-5 text-center shadow-[0_18px_40px_-28px_rgba(20,22,40,.35)]">
        <span
          className="drive-pop mx-auto mb-2.5 grid size-14 place-items-center rounded-full"
          style={{ background: "rgba(22,179,100,.12)" }}
        >
          <Check className="size-6" style={{ color: GO }} />
        </span>
        <h1 className="drive-sora text-heading-lg font-extrabold tracking-[-0.5px]">
          {tr("Course terminée", "انتهى المشوار")}
        </h1>
        <p
          className="drive-sora mt-1 text-[32px] leading-none font-extrabold tracking-[-1px]"
          style={{ color: GO }}
        >
          +{formatDA(done.net_da + tip)}
        </p>
        <p className="text-label mt-1.5 font-semibold text-[var(--d-muted)]">
          {done.pickup_text ?? "—"} → {done.dest_text ?? "—"}
        </p>
      </div>

      <div className="px-5">
        {/* ── Pourboire reçu (apparaît en DIRECT si le client en laisse un) ── */}
        {tip > 0 && (
          <div
            className="drive-up mt-2.5 flex items-center gap-3 rounded-lg p-3"
            style={{ background: "rgba(22,179,100,.12)" }}
          >
            <span className="drive-pop rounded-control-lg grid size-9 shrink-0 place-items-center bg-[var(--d-surface)]">
              <HandCoins className="size-5" style={{ color: GO }} />
            </span>
            <b className="text-body" style={{ color: GO }}>
              {tr("Pourboire du client", "إكرامية من الزبون")} · +
              {formatDA(tip)}
            </b>
          </div>
        )}

        {/* ── Détail du gain ── */}
        <div className="drive-rise rounded-sheet-lg mt-2.5 border border-[var(--d-line)] bg-[var(--d-surface)] px-4 py-1.5">
          <div className="text-body flex items-center justify-between py-2">
            <span className="text-[var(--d-muted)]">
              {tr("Prix de la course", "ثمن المشوار")}
            </span>
            <span>{formatDA(done.price_da)}</span>
          </div>
          <div className="text-body flex items-center justify-between border-t border-[var(--d-line)] py-2">
            <span className="text-[var(--d-muted)]">
              {tr("Commission Coligo", "عمولة كوليغو")} ({pct})
            </span>
            <span style={{ color: RED }}>−{formatDA(done.commission_da)}</span>
          </div>
          {tip > 0 && (
            <div className="text-body flex items-center justify-between border-t border-[var(--d-line)] py-2">
              <span className="text-[var(--d-muted)]">
                {tr("Pourboire", "الإكرامية")}
              </span>
              <span style={{ color: GO }}>+{formatDA(tip)}</span>
            </div>
          )}
        </div>

        {/* ── Encaissement ── */}
        <div
          className="drive-rise mt-2.5 flex items-center gap-3 rounded-lg p-3"
          style={{ background: "rgba(22,179,100,.12)", animationDelay: ".05s" }}
        >
          <span className="rounded-control-lg grid size-9 shrink-0 place-items-center bg-[var(--d-surface)]">
            <BadgeCheck className="size-5" style={{ color: GO }} />
          </span>
          <span>
            <b className="text-body block" style={{ color: GO }}>
              {done.payment_method === "cash"
                ? tr(
                    "Espèces encaissées auprès du client",
                    "نقدًا، حُصِّلت من الزبون"
                  )
                : done.cash_due_da > 0
                  ? isAr
                    ? `${formatDA(done.cash_due_da)} حُصِّلت نقدًا · ${formatDA(done.price_da - done.cash_due_da)} عبر كوليغو باي، أُضيفت إلى رصيدك`
                    : `${formatDA(done.cash_due_da)} encaissés en espèces · ${formatDA(done.price_da - done.cash_due_da)} via Coligo Pay, crédités sur votre solde`
                  : // Carte bancaire distinguée de Coligo Pay : même logique
                    // métier (encaissée par Coligo puis créditée), mais le
                    // chauffeur voit le vrai moyen de paiement du client.
                    done.payment_method === "card"
                    ? tr(
                        "Payée par carte bancaire · créditée sur votre solde",
                        "مدفوعة بالبطاقة البنكية · أُضيفت إلى رصيدك"
                      )
                    : tr(
                        "Prépayée (Coligo Pay) · encaissée par Coligo, créditée sur votre solde",
                        "مدفوعة مسبقًا (كوليغو باي) · حصّلتها كوليغو وأُضيفت إلى رصيدك"
                      )}
            </b>
            {done.commission_da > 0 && (
              <span className="text-caption text-[var(--d-muted)]">
                {tr(
                  "Avec Premium (0 %), vous auriez gardé",
                  "مع Premium (0 %)، لكنت احتفظت بـ"
                )}{" "}
                <b>{formatDA(done.price_da)}</b>
              </span>
            )}
          </span>
        </div>

        {queued && (
          <div
            className="drive-rise mt-2.5 flex items-center gap-3 rounded-lg p-3"
            style={{ background: "var(--d-accent)", animationDelay: ".1s" }}
          >
            <span className="rounded-control-lg grid size-9 shrink-0 place-items-center bg-[var(--d-surface)]">
              <Zap className="size-4.5" style={{ color: VIOLET }} />
            </span>
            <span>
              <b className="text-body block" style={{ color: VIOLET }}>
                {tr("Course suivante :", "المشوار التالي:")}{" "}
                {queued.customer_name} ·{" "}
                {queued.proposed_price_da + queued.boost_amount_da}{" "}
                {tr("DA", "دج")}
              </b>
              <span className="text-caption text-[var(--d-muted)]">
                {tr("À", "على بعد")}{" "}
                {`${(Math.round(queued.pickup_dist_km * 10) / 10).toString().replace(".", ",")} ${tr("km", "كم")}`}{" "}
                · {tr("le client vous attend", "الزبون في انتظارك")}
              </span>
            </span>
          </div>
        )}

        {/* ── Notation du client (étoiles + libellé) ── */}
        <div
          className="drive-rise rounded-sheet-lg mt-2.5 border border-[var(--d-line)] bg-[var(--d-surface)] p-4"
          style={{ animationDelay: ".15s" }}
        >
          <p className="text-body-sm mb-1.5 text-center font-semibold">
            {tr("Notez le client", "قيّم الزبون")}
          </p>
          <div className="flex justify-center gap-2.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={rateLabels[n - 1]}
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
            className="text-caption-lg mt-1.5 h-4 text-center font-bold"
            style={{ color: rating > 0 ? "#B45309" : "var(--d-muted)" }}
          >
            {rating > 0 ? rateLabels[rating - 1] : " "}
          </p>
        </div>

        {reported ? (
          <div
            className="rounded-card text-caption-lg mt-3 mb-1 flex items-start gap-2 px-3 py-2.5 leading-relaxed font-semibold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            <BadgeCheck className="mt-0.5 size-4 shrink-0" />
            {isAr
              ? `تم إرسال البلاغ («${reported}»). فحص خلال 24 ساعة — قد يُعلَّق حساب الزبون. سيتم إعلامك بالقرار.`
              : `Signalement transmis (« ${reported} »). Examen sous 24 h — le client peut être suspendu. Vous serez informé de la décision.`}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="text-label-lg mt-3 mb-1 block w-full text-center font-bold"
            style={{ color: RED }}
          >
            {tr(
              "Signaler un problème avec ce client",
              "الإبلاغ عن مشكلة مع هذا الزبون"
            )}
          </button>
        )}

        <PrimaryBtn onClick={queued ? () => void onChainQueued() : onRequests}>
          {queued
            ? isAr
              ? `متابعة · اذهب لأخذ ${queued.customer_name}`
              : `Enchaîner · aller chercher ${queued.customer_name}`
            : tr("Voir les demandes suivantes", "عرض الطلبات التالية")}
        </PrimaryBtn>
        <GhostBtn onClick={onHome}>
          {tr("Retour à l'accueil", "العودة إلى الرئيسية")}
        </GhostBtn>
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
