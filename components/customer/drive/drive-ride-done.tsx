"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, Gift, Star, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { ChAvatar } from "./ch-avatar";
import { PrimaryBtn, ReportModal, GO, ROSE, RED } from "./drive-modals";
import {
  rateDriveRide,
  reportDriveRide,
  toggleFavoriteChauffeur,
  type DriveLastRide,
} from "@/app/(customer)/drive/actions";

export function DoneScreen({
  ride,
  onExit,
}: {
  ride: NonNullable<DriveLastRide>;
  onExit: () => void;
}) {
  const t = useTranslations("drive.done");
  const [rating, setRating] = useState(ride.my_rating ?? 0);
  const [fav, setFav] = useState(ride.chauffeur?.is_favorite ?? false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState<string | null>(null);

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

  return (
    <div className="drive-jakarta drive-screen z-40 overflow-y-auto bg-[var(--d-surface)] px-5 pt-6 pb-8">
      <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
        {t("title")}
      </h1>
      <p className="mb-4 text-[13px] text-[var(--d-muted)]">
        {ride.pickup_text ?? "—"} → {ride.dest_text ?? "—"}
      </p>

      {ride.chauffeur && (
        <div className="mb-3 flex items-center gap-3 rounded-[15px] bg-[var(--d-soft)] px-3 py-2.5">
          <ChAvatar
            name={ride.chauffeur.name}
            url={ride.chauffeur.avatar_url}
            size={40}
          />
          <span>
            <b className="block text-[13.5px]">{ride.chauffeur.name}</b>
            <span className="text-[10.5px] text-[var(--d-muted)]">
              {t("maskedAfter")}
            </span>
          </span>
        </div>
      )}

      <div className="mb-3 rounded-[18px] border border-[var(--d-line)] p-4">
        <Row k={t("agreed")} v={formatDA(ride.price_da)} />
        {commissionPct && (
          <Row
            k={t("commission", { pct: commissionPct })}
            v={t("included")}
            muted
          />
        )}
        <div className="mt-1 flex items-center justify-between border-t border-[var(--d-line)] pt-3 text-sm font-bold">
          <span className="text-[var(--d-muted)]">{payLabel}</span>
          <span className="drive-sora text-lg">{formatDA(ride.price_da)}</span>
        </div>
        {mixed && (
          <p className="mt-1 text-[11.5px] font-semibold text-[var(--d-muted)]">
            {t("payMixedDetail", {
              wallet: ride.price_da - ride.cash_due_da,
              cash: ride.cash_due_da,
            })}
          </p>
        )}
      </div>

      {ride.cashback_da > 0 && (
        <div
          className="mb-3 flex items-center gap-3 rounded-[16px] p-3"
          style={{ background: "rgba(22,179,100,.12)" }}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
            <Gift className="size-5" style={{ color: GO }} />
          </span>
          <span>
            <b className="block text-[13.5px]" style={{ color: GO }}>
              {t("cashback", { amount: ride.cashback_da })}
            </b>
            <span className="text-[11px] text-[var(--d-muted)]">
              {t("cashbackSub")}
            </span>
          </span>
        </div>
      )}

      <p className="mb-1 text-center text-sm font-semibold">{t("rateTitle")}</p>
      <div className="mb-3 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={async () => {
              setRating(n);
              await rateDriveRide(ride.id, n);
            }}
          >
            <Star
              className="size-8"
              style={{
                color: "#E8B53C",
                fill: n <= rating ? "#E8B53C" : "transparent",
              }}
            />
          </button>
        ))}
      </div>

      {ride.chauffeur && (
        <button
          type="button"
          onClick={async () => {
            const next = !fav;
            setFav(next);
            await toggleFavoriteChauffeur(ride.chauffeur!.id, next);
          }}
          className="mb-2.5 h-[46px] w-full rounded-[14px] border-[1.5px] text-[13px] font-bold"
          style={
            fav
              ? {
                  borderColor: ROSE,
                  color: ROSE,
                  background: "rgba(236,72,153,.13)",
                }
              : { borderColor: "var(--d-line)" }
          }
        >
          {fav
            ? t("favOn", { name: ride.chauffeur.name })
            : t("favOff", { name: ride.chauffeur.name })}
        </button>
      )}

      {reported ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-[13px] px-3 py-2.5 text-[11.5px] leading-relaxed font-semibold"
          style={{ background: "rgba(22,179,100,.12)", color: GO }}
        >
          <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          {t("reportOk", { reason: reported })}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="mb-2 block w-full text-center text-[12.5px] font-bold"
          style={{ color: RED }}
        >
          {t("reportBtn")}
        </button>
      )}

      <PrimaryBtn onClick={onExit}>{t("finish")}</PrimaryBtn>

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

function Row({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 text-[13.5px]">
      <span className="text-[var(--d-muted)]">{k}</span>
      <span className={cn(muted && "text-[var(--d-muted)]")}>{v}</span>
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
    <div className="drive-jakarta drive-screen z-40 bg-[var(--d-surface)] px-5 pt-12">
      <div className="flex flex-col items-center text-center">
        <span
          className="mb-3 grid size-16 place-items-center rounded-full"
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
            className="mt-2 max-w-[300px] rounded-[12px] px-3 py-2 text-[12px] font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {t("refunded")}
          </p>
        )}
      </div>
      {reason && (
        <div className="mt-4 rounded-[18px] border border-[var(--d-line)] p-4">
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
