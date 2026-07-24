"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Gift, Hourglass, Loader2, RotateCcw, Wallet } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";

// =============================================================================
// WheelView — la roue quotidienne. Le SERVEUR tire d'abord (RPC wheel_spin),
// PUIS la roue anime vers le segment gagné (jamais l'inverse). Un tour/jour ;
// les lots « bon d'achat » sont crédités sur Coligo Pay pendant l'animation.
// =============================================================================

export type WheelPrize = {
  id: string;
  kind: "voucher" | "nothing";
  amount_da: number;
  label_fr: string;
  label_ar: string | null;
};

export type WheelState = {
  enabled: boolean;
  can_spin: boolean;
  streak: number;
  streak_target: number;
  streak_multiplier: number;
  today: { prize_id: string | null; amount_da: number } | null;
};

type SpinResult = {
  ok: boolean;
  reason?: string;
  prize_id?: string;
  kind?: "voucher" | "nothing";
  amount_da?: number;
  label_fr?: string;
  label_ar?: string | null;
  streak?: number;
  bonus?: boolean;
};

const SEGMENT_COLORS = [
  "#6C2BD9",
  "#FF2D7A",
  "#8A4DFF",
  "#0EA5E9",
  "#4B1FA6",
  "#F59E0B",
  "#14B8A6",
  "#E11D48",
];

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
}

export function WheelView({
  state,
  prizes,
}: {
  state: WheelState | null;
  prizes: WheelPrize[];
}) {
  const t = useTranslations("wheel");
  const locale = useLocale();
  const ar = locale === "ar";
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spentToday, setSpentToday] = useState(!state?.can_spin);
  const [streak, setStreak] = useState(state?.streak ?? 0);
  const doneRef = useRef(false);

  const seg = 360 / Math.max(prizes.length, 1);

  const wheelSvg = useMemo(() => {
    const R = 150;
    return (
      <svg viewBox="0 0 300 300" className="size-full">
        {prizes.map((p, i) => {
          const a0 = i * seg;
          const a1 = (i + 1) * seg;
          const [x0, y0] = polar(150, 150, R, a0);
          const [x1, y1] = polar(150, 150, R, a1);
          const mid = a0 + seg / 2;
          const [tx, ty] = polar(150, 150, R * 0.62, mid);
          const label = p.kind === "nothing" ? "↻" : `${p.amount_da}`;
          return (
            <g key={p.id}>
              <path
                d={`M150 150 L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`}
                fill={SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
                stroke="rgba(255,255,255,.35)"
                strokeWidth="2"
              />
              <text
                x={tx}
                y={ty}
                fill="#fff"
                fontSize={p.kind === "nothing" ? 26 : 24}
                fontWeight="900"
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${mid} ${tx} ${ty})`}
              >
                {label}
              </text>
              {p.kind !== "nothing" && (
                <text
                  x={tx}
                  y={ty + 18}
                  fill="rgba(255,255,255,.85)"
                  fontSize="11"
                  fontWeight="700"
                  textAnchor="middle"
                  transform={`rotate(${mid} ${tx} ${ty + 18})`}
                >
                  DA
                </text>
              )}
            </g>
          );
        })}
        <circle cx="150" cy="150" r="26" fill="#fff" />
        <circle cx="150" cy="150" r="20" fill="#6C2BD9" />
      </svg>
    );
  }, [prizes, seg]);

  const spin = async () => {
    if (spinning || spentToday) return;
    setError(null);
    setSpinning(true);
    doneRef.current = false;
    try {
      const supabase = createClient();
      // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string
      ) => Promise<{
        data: SpinResult | null;
        error: { message: string } | null;
      }>;
      const { data, error: rpcErr } = await rpc("wheel_spin");
      if (rpcErr || !data?.ok) {
        setSpinning(false);
        if (data?.reason === "already_spun") {
          setSpentToday(true);
          setError(t("alreadyPlayed"));
        } else {
          setError(t("spinError"));
        }
        return;
      }
      setResult(data);
      setStreak(data.streak ?? 1);
      // Anime vers le segment gagné : 5 tours + arrêt pile sous l'aiguille.
      const idx = Math.max(
        prizes.findIndex((p) => p.id === data.prize_id),
        0
      );
      const target = 360 * 5 + (360 - (idx * seg + seg / 2));
      setRotation((r) => r + target - (r % 360));
    } catch {
      setSpinning(false);
      setError(t("spinError"));
    }
  };

  const onSpinEnd = () => {
    if (doneRef.current || !result) return;
    doneRef.current = true;
    setSpinning(false);
    setSpentToday(true);
    setShowResult(true);
  };

  if (!state || !state.enabled) {
    return (
      <div className="bg-surface rounded-[20px] p-6 text-center shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
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

  const dots = Array.from({ length: state.streak_target }, (_, i) => i);
  const filled =
    streak % state.streak_target || (streak > 0 ? state.streak_target : 0);

  return (
    <div className="space-y-4">
      {/* ── LA ROUE ── */}
      <div className="relative mx-auto w-full max-w-[320px]">
        {/* Aiguille */}
        <div className="absolute top-[-6px] left-1/2 z-10 -translate-x-1/2">
          <div className="h-0 w-0 border-x-[14px] border-t-[22px] border-x-transparent border-t-[#FF2D7A] drop-shadow" />
        </div>
        <div
          onTransitionEnd={onSpinEnd}
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning
              ? "transform 4.2s cubic-bezier(0.12, 0.8, 0.22, 1)"
              : undefined,
          }}
          className="aspect-square w-full rounded-full shadow-[0_18px_44px_-18px_rgba(76,27,155,.5)]"
        >
          {wheelSvg}
        </div>
      </div>

      {error && (
        <p className="rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-center text-sm font-medium text-rose-800">
          {error}
        </p>
      )}

      {/* ── CTA ── */}
      {spentToday && !spinning ? (
        <div className="bg-surface rounded-[16px] p-4 text-center shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
          <p className="text-foreground text-sm font-extrabold">
            {t("comeBack")}
          </p>
          <p className="text-muted mt-0.5 text-xs">{t("comeBackDesc")}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void spin()}
          disabled={spinning}
          className="bg-primary-600 hover:bg-primary-700 inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-[14px] text-base font-extrabold text-white shadow-[0_10px_24px_-8px_rgba(91,46,255,0.5)] transition active:scale-[0.98] disabled:opacity-70"
        >
          {spinning ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              {t("spinning")}
            </>
          ) : (
            t("spinCta")
          )}
        </button>
      )}

      {/* ── SÉRIE ── */}
      <div className="bg-surface rounded-[16px] p-4 shadow-[0_8px_22px_-16px_rgba(40,35,90,.2)]">
        <div className="flex items-center justify-between">
          <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
            {t("streakTitle")}
          </p>
          <p className="text-primary-700 text-xs font-black tabular-nums">
            {streak} {ar ? "" : "j"}
          </p>
        </div>
        <div className="mt-2 flex gap-1.5">
          {dots.map((i) => (
            <span
              key={i}
              className={cn(
                "h-2 flex-1 rounded-full",
                i < filled ? "bg-primary-600" : "bg-surface-3"
              )}
            />
          ))}
        </div>
        <p className="text-subtle mt-2 text-xs">
          {t("streakHint", {
            target: state.streak_target,
            mult: state.streak_multiplier,
          })}
        </p>
      </div>

      {/* ── RÉSULTAT ── */}
      {showResult && result && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(11,11,15,0.55)] px-5 backdrop-blur-[2px]"
          onClick={() => setShowResult(false)}
        >
          <div
            className="bg-surface w-full max-w-[380px] rounded-[26px] p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {result.kind === "voucher" ? (
              <>
                <ColigoCelebration variant="verified" />
                <p className="text-foreground mt-2 text-xl font-extrabold">
                  {t("wonTitle", { amount: formatDA(result.amount_da ?? 0) })}
                </p>
                {result.bonus && (
                  <p className="text-primary-700 mt-1 text-sm font-extrabold">
                    {t("bonusApplied", { mult: state.streak_multiplier })}
                  </p>
                )}
                <p className="text-muted mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium">
                  <Wallet className="size-4" />
                  {t("wonDesc")}
                </p>
              </>
            ) : (
              <>
                <span className="bg-surface-2 text-subtle mx-auto grid size-14 place-items-center rounded-2xl">
                  <RotateCcw className="size-7" />
                </span>
                <p className="text-foreground mt-3 text-xl font-extrabold">
                  {t("nothingTitle")}
                </p>
                <p className="text-muted mt-1 text-sm">{t("nothingDesc")}</p>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowResult(false)}
              className="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[13px] px-4 py-3 text-sm font-extrabold text-white"
            >
              <Gift className="size-4" />
              {t("resultClose")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
