"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  Copy,
  Gift,
  Hourglass,
  Link2,
  MessageCircle,
  Users,
} from "lucide-react";
import { AvatarDot } from "@/components/ui/avatar-dot";
import { formatDA } from "@/lib/utils";
import type {
  ReferralOverview,
  ReferralReferee,
} from "@/lib/referral/overview";

/**
 * Vue « Parrainage » : héro violet (code + partage WhatsApp), stats, étapes,
 * liste des filleuls. Textes courts, messages inline, RTL logique.
 */
export function ReferralView({
  overview,
  appUrl,
}: {
  overview: ReferralOverview | null;
  appUrl: string;
}) {
  const t = useTranslations("referral");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  if (!overview) {
    return (
      <div className="rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {t("loadError")}
      </div>
    );
  }

  // Programme coupé / « bientôt » (flag ou réglage admin) → état compact.
  if (!overview.enabled) {
    return (
      <div className="rounded-[20px] bg-white p-6 text-center shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
        <span className="bg-primary-50 text-primary-600 mx-auto grid size-12 place-items-center rounded-2xl">
          <Hourglass className="size-6" />
        </span>
        <p className="text-foreground mt-3 text-base font-extrabold">
          {t("soonTitle")}
        </p>
        <p className="text-muted mt-1 text-sm">{t("soonDesc")}</p>
      </div>
    );
  }

  const link = `${appUrl.replace(/\/+$/, "")}/r/${overview.code}`;
  const waText = t("waMessage", {
    code: overview.code,
    amount: overview.reward_referee_da,
    link,
  });
  const waHref = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  const copy = async (what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(
        what === "code" ? overview.code : link
      );
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard indisponible (http / très vieux navigateur) : rien */
    }
  };

  return (
    <div className="space-y-4">
      {/* HERO — code + partage */}
      <section className="from-primary-500 via-primary-600 to-primary-800 relative overflow-hidden rounded-[20px] bg-gradient-to-br p-5 text-white shadow-[0_14px_30px_-16px_rgba(76,27,155,.55)]">
        <span className="pointer-events-none absolute -end-10 -top-14 size-44 rounded-full border border-white/15" />
        <span className="pointer-events-none absolute end-6 -top-6 size-24 rounded-full border border-white/10" />

        <p className="text-lg leading-snug font-extrabold tracking-tight">
          {t("heroTitle", { amount: overview.reward_referrer_da })}
        </p>
        <p className="mt-1 text-[13px] font-medium text-white/85">
          {t("heroSubtitle", {
            amount: overview.reward_referee_da,
            min: overview.min_order_da,
          })}
        </p>

        {/* Code — pointillés façon coupon */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 rounded-[14px] border-2 border-dashed border-white/40 bg-white/10 px-3 py-2.5 text-center">
            <p className="text-[10px] font-bold tracking-widest text-white/70 uppercase">
              {t("yourCode")}
            </p>
            <p className="font-mono text-xl font-black tracking-[.25em]">
              {overview.code}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copy("code")}
            aria-label={t("copyCode")}
            className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-white/15 transition-colors hover:bg-white/25 active:scale-95"
          >
            {copied === "code" ? (
              <Check className="size-5" />
            ) : (
              <Copy className="size-5" />
            )}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-700 inline-flex items-center justify-center gap-2 rounded-[14px] bg-white px-4 py-3 text-sm font-extrabold shadow-sm transition-transform active:scale-[.98]"
          >
            <MessageCircle className="size-4.5" />
            {t("inviteWhatsapp")}
          </a>
          <button
            type="button"
            onClick={() => void copy("link")}
            aria-label={t("copyLink")}
            className="grid size-11 place-items-center self-center rounded-[14px] bg-white/15 transition-colors hover:bg-white/25 active:scale-95"
          >
            {copied === "link" ? (
              <Check className="size-5" />
            ) : (
              <Link2 className="size-5" />
            )}
          </button>
        </div>
        {copied && (
          <p className="mt-2 text-center text-xs font-bold text-white/90">
            {copied === "code" ? t("copied") : t("linkCopied")}
          </p>
        )}
      </section>

      {/* STATS */}
      <section className="grid grid-cols-3 gap-3">
        <StatTile
          value={String(overview.stats.invited)}
          label={t("statInvited")}
        />
        <StatTile
          value={String(overview.stats.rewarded)}
          label={t("statRewarded")}
        />
        <StatTile
          value={formatDA(overview.stats.earned_da)}
          label={t("statEarned")}
        />
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section className="rounded-[16px] bg-white p-4 shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
        <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
          {t("howTitle")}
        </p>
        <ol className="mt-2 space-y-2">
          {[t("step1"), t("step2"), t("step3")].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="bg-primary-50 text-primary-700 mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-black">
                {i + 1}
              </span>
              <span className="text-foreground text-sm font-medium">
                {step}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* FILLEULS */}
      <section className="rounded-[16px] bg-white p-4 shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
        <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
          {t("listTitle")}
        </p>
        {overview.referees.length === 0 ? (
          <div className="py-5 text-center">
            <span className="bg-surface-2 text-subtle mx-auto grid size-11 place-items-center rounded-2xl">
              <Users className="size-5" />
            </span>
            <p className="text-foreground mt-2 text-sm font-bold">
              {t("emptyTitle")}
            </p>
            <p className="text-muted mt-0.5 text-xs">{t("emptyDesc")}</p>
          </div>
        ) : (
          <ul className="divide-border mt-1 divide-y">
            {overview.referees.map((ref, i) => (
              <RefereeRow key={i} referee={ref} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[16px] bg-white p-3 text-center shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
      <p className="text-foreground text-lg font-black tracking-tight tabular-nums">
        {value}
      </p>
      <p className="text-muted text-[11px] font-bold">{label}</p>
    </div>
  );
}

function RefereeRow({ referee }: { referee: ReferralReferee }) {
  const t = useTranslations("referral");
  const badge =
    referee.status === "rewarded" ? (
      <span className="bg-success-50 text-success-700 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold">
        <Gift className="size-3" />+ {formatDA(referee.amount_da)}
      </span>
    ) : referee.status === "waiting" ? (
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-700">
        {t("statusWaiting")}
      </span>
    ) : (
      <span className="bg-surface-2 text-subtle rounded-full px-2.5 py-1 text-[11px] font-extrabold">
        {t("statusExpired")}
      </span>
    );

  return (
    <li className="flex items-center gap-3 py-2.5">
      <AvatarDot name={referee.name || "?"} size="sm" />
      <span className="text-foreground min-w-0 flex-1 truncate text-sm font-bold">
        {referee.name || "—"}
      </span>
      {badge}
    </li>
  );
}
