"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  BadgeCheck,
  Check,
  Gift,
  Heart,
  HandCoins,
  Loader2,
  Star,
  X,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { ChAvatar } from "./ch-avatar";
import { PrimaryBtn, ReportModal, GO, ROSE, RED, VIOLET } from "./drive-modals";
import {
  rateDriveRide,
  reportDriveRide,
  tipDriveRide,
  toggleFavoriteChauffeur,
  type DriveLastRide,
} from "@/app/(customer)/drive/actions";

/** Paliers de pourboire proposés (DA) — filtrés par le solde Coligo Pay. */
const TIP_STEPS = [50, 100, 200];

export function DoneScreen({
  ride,
  onExit,
}: {
  ride: NonNullable<DriveLastRide>;
  onExit: () => void;
}) {
  const t = useTranslations("drive.done");
  const [rating, setRating] = useState(ride.my_rating ?? 0);
  const [rated, setRated] = useState(ride.my_rating != null);
  const [fav, setFav] = useState(ride.chauffeur?.is_favorite ?? false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState<string | null>(null);

  // Pourboire (mig 0363) : via Coligo Pay uniquement, une seule fois.
  const [tipSent, setTipSent] = useState(ride.tip_da > 0 ? ride.tip_da : 0);
  const [tipPending, setTipPending] = useState<number | null>(null);
  const [tipErr, setTipErr] = useState<string | null>(null);
  const tipChoices = TIP_STEPS.filter((v) => v <= ride.wallet_balance_da);
  const showTip =
    !!ride.chauffeur &&
    (tipSent > 0 || (ride.tip_da === 0 && tipChoices.length > 0));

  const sendTip = async (amount: number) => {
    if (tipPending != null || tipSent > 0) return;
    setTipPending(amount);
    setTipErr(null);
    try {
      const res = await tipDriveRide(ride.id, amount);
      if (res.ok) setTipSent(amount);
      else setTipErr(t("tipErr"));
    } catch {
      setTipErr(t("tipErr"));
    } finally {
      setTipPending(null);
    }
  };

  // Coligo Pay partiel : séquestre + complément espèces (mig 0163).
  const mixed = ride.payment_method === "coligo_pay" && ride.cash_due_da > 0;
  const payLabel =
    ride.payment_method === "cash"
      ? t("payCash")
      : ride.payment_method === "card"
        ? t("payCard")
        : mixed
          ? t("payMixed")
          : t("payCpay");
  const commissionPct =
    ride.commission_rate != null
      ? `${String(Math.round(ride.commission_rate * 1000) / 10).replace(".", ",")} %`
      : null;
  const rateLabels = t.raw("rateLabels") as string[];

  return (
    <div className="drive-jakarta drive-screen z-40 overflow-y-auto bg-[var(--d-page)] pb-8">
      {/* ── Héro : succès + prix (l'info d'un coup d'œil, façon Bolt) ── */}
      <div className="rounded-b-[28px] bg-[var(--d-surface)] px-5 pt-7 pb-5 text-center shadow-[0_18px_40px_-28px_rgba(20,22,40,.35)]">
        <span
          className="drive-pop mx-auto mb-2.5 grid size-14 place-items-center rounded-full"
          style={{ background: "rgba(22,179,100,.12)" }}
        >
          <Check className="size-6" style={{ color: GO }} />
        </span>
        <h1 className="drive-sora text-[20px] font-extrabold tracking-[-0.5px]">
          {t("title")}
        </h1>
        <p className="drive-sora mt-1 text-[32px] leading-none font-extrabold tracking-[-1px]">
          {formatDA(ride.price_da)}
        </p>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--d-soft)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--d-muted)]">
          <BadgeCheck className="size-3.5" style={{ color: GO }} />
          {payLabel}
        </span>
        {mixed && (
          <p className="mt-1.5 text-[11.5px] font-semibold text-[var(--d-muted)]">
            {t("payMixedDetail", {
              wallet: ride.price_da - ride.cash_due_da,
              cash: ride.cash_due_da,
            })}
          </p>
        )}
      </div>

      <div className="px-5">
        {/* ── Trajet (rail A → B) + commission ── */}
        <div className="drive-rise mt-2.5 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5">
          <div className="flex gap-2.5">
            <div className="flex w-3 shrink-0 flex-col items-center pt-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: VIOLET }}
              />
              <span className="my-0.5 w-[1.5px] flex-1 bg-[var(--d-line)]" />
              <span className="size-1.5 shrink-0 rounded-full bg-[var(--d-ink)]" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 text-[12.5px] font-semibold">
              <span className="truncate">{ride.pickup_text ?? "—"}</span>
              <span className="truncate">{ride.dest_text ?? "—"}</span>
            </div>
          </div>
          {commissionPct && (
            <p className="mt-2.5 border-t border-[var(--d-line)] pt-2 text-[11px] font-semibold text-[var(--d-muted)]">
              {t("commission", { pct: commissionPct })} · {t("included")}
            </p>
          )}
        </div>

        {/* ── Cashback gagné ── */}
        {ride.cashback_da > 0 && (
          <div
            className="drive-rise mt-2.5 flex items-center gap-3 rounded-[16px] p-3"
            style={{
              background: "rgba(22,179,100,.12)",
              animationDelay: ".05s",
            }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
              <Gift className="size-4.5" style={{ color: GO }} />
            </span>
            <span className="min-w-0">
              <b className="block text-[13px]" style={{ color: GO }}>
                {t("cashback", { amount: ride.cashback_da })}
              </b>
              <span className="text-[11px] text-[var(--d-muted)]">
                {t("cashbackSub")}
              </span>
            </span>
          </div>
        )}

        {/* ── Chauffeur : notation (étoiles + libellé) + favori ── */}
        {ride.chauffeur && (
          <div
            className="drive-rise mt-2.5 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4"
            style={{ animationDelay: ".1s" }}
          >
            <div className="flex items-center gap-3">
              <ChAvatar
                name={ride.chauffeur.name}
                url={ride.chauffeur.avatar_url}
                size={44}
              />
              <span className="min-w-0 flex-1">
                <b className="block text-[14px]">{ride.chauffeur.name}</b>
                <span className="text-[10.5px] text-[var(--d-muted)]">
                  {t("maskedAfter")}
                </span>
              </span>
              {/* Favori : cœur compact (RLS : possible après course terminée). */}
              <button
                type="button"
                aria-label={fav ? t("favOn") : t("favOff")}
                onClick={async () => {
                  const next = !fav;
                  setFav(next);
                  await toggleFavoriteChauffeur(ride.chauffeur!.id, next);
                }}
                className="grid size-10 shrink-0 place-items-center rounded-full border-[1.5px] transition-transform active:scale-90"
                style={
                  fav
                    ? {
                        borderColor: ROSE,
                        background: "rgba(236,72,153,.13)",
                      }
                    : { borderColor: "var(--d-line)" }
                }
              >
                <Heart
                  className="size-[18px]"
                  style={{
                    color: fav ? ROSE : "var(--d-muted)",
                    fill: fav ? ROSE : "transparent",
                  }}
                />
              </button>
            </div>

            <p className="mt-3 mb-1.5 text-center text-[13px] font-semibold">
              {t("rateTitle")}
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
                    setRated(true);
                    await rateDriveRide(ride.id, n);
                  }}
                >
                  <Star
                    className={cn("size-9", n <= rating && "drive-pop")}
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
              {rating > 0 ? rateLabels[rating - 1] : " "}
            </p>
            {rated && (
              <p
                className="drive-rise text-center text-[11px] font-semibold"
                style={{ color: GO }}
              >
                {t("rated")}
              </p>
            )}
          </div>
        )}

        {/* ── Pourboire Coligo Pay (100 % pour le chauffeur) ── */}
        {showTip && (
          <div
            className="drive-rise mt-2.5 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4"
            style={{ animationDelay: ".15s" }}
          >
            {tipSent > 0 ? (
              <div className="flex items-center gap-3">
                <span
                  className="drive-pop grid size-10 shrink-0 place-items-center rounded-full"
                  style={{ background: "rgba(22,179,100,.12)" }}
                >
                  <HandCoins className="size-5" style={{ color: GO }} />
                </span>
                <b className="text-[13px]" style={{ color: GO }}>
                  {t("tipSent", { amount: tipSent })}
                </b>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-[11px]"
                    style={{ background: "var(--d-accent)", color: VIOLET }}
                  >
                    <HandCoins className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13px]">
                      {t("tipTitle", { name: ride.chauffeur!.name })}
                    </b>
                    <span className="text-[10.5px] text-[var(--d-muted)]">
                      {t("tipSub", { balance: ride.wallet_balance_da })}
                    </span>
                  </span>
                </div>
                <div className="mt-2.5 flex gap-2">
                  {tipChoices.map((v) => (
                    <button
                      key={v}
                      type="button"
                      disabled={tipPending != null}
                      onClick={() => void sendTip(v)}
                      className="drive-sora flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[13px] border-[1.5px] text-[14px] font-extrabold transition-transform active:scale-95 disabled:opacity-50"
                      style={{ borderColor: "var(--d-line)", color: VIOLET }}
                    >
                      {tipPending === v ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>+{v}</>
                      )}
                    </button>
                  ))}
                </div>
                {tipErr && (
                  <p
                    className="mt-1.5 text-center text-[11.5px] font-bold"
                    style={{ color: RED }}
                  >
                    {tipErr}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Signalement + sortie ── */}
        {reported ? (
          <div
            className="mt-3 mb-1 flex items-start gap-2 rounded-[13px] px-3 py-2.5 text-[11.5px] leading-relaxed font-semibold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            <BadgeCheck className="mt-0.5 size-4 shrink-0" />
            {t("reportOk", { reason: reported })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="mt-3 mb-1 block w-full text-center text-[12.5px] font-bold"
            style={{ color: RED }}
          >
            {t("reportBtn")}
          </button>
        )}

        <PrimaryBtn onClick={onExit}>{t("finish")}</PrimaryBtn>
      </div>

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        side="client"
        onConfirm={async (reason) => {
          setReportOpen(false);
          await reportDriveRide(ride.id, reason);
          setReported(reason);
        }}
      />
    </div>
  );
}

/* ════════════════ COURSE ANNULÉE ════════════════ */

export function CancelledScreen({
  reason,
  mine,
  refunded,
  onExit,
}: {
  reason: string | null;
  mine: boolean;
  refunded?: boolean;
  onExit: () => void;
}) {
  const t = useTranslations("drive.cancelledScreen");
  return (
    <div className="drive-jakarta drive-screen z-40 bg-[var(--d-surface)] px-5 pt-[calc(3rem+env(safe-area-inset-top))]">
      <div className="flex flex-col items-center text-center">
        <span
          className="drive-pop mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(229,72,77,.1)" }}
        >
          <X className="size-7" style={{ color: RED }} />
        </span>
        <h1 className="drive-sora text-[21px] font-extrabold">{t("title")}</h1>
        <p className="mt-1 max-w-[280px] text-[13px] text-[var(--d-muted)]">
          {mine ? t("byYou") : t("byOther")}
        </p>
        {refunded && (
          <p
            className="drive-rise mt-2 max-w-[300px] rounded-[12px] px-3 py-2 text-[12px] font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {t("refunded")}
          </p>
        )}
      </div>
      {reason && (
        <div className="drive-rise mt-4 rounded-[18px] border border-[var(--d-line)] p-4">
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-[var(--d-muted)]">{t("reason")}</span>
            <span className="font-semibold">{reason}</span>
          </div>
        </div>
      )}
      <PrimaryBtn onClick={onExit} className="mt-5">
        {t("back")}
      </PrimaryBtn>
    </div>
  );
}
