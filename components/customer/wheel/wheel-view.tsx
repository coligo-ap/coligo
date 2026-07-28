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

// ── Habillage « jeu » (style Temu/Shein) — 100 % CSS, valeurs PRÉCALCULÉES
// (déterministes : pas de Math.random au rendu). ──────────────────────────────

/** 16 ampoules sur l'anneau (positions en % — fluide quel que soit la taille). */
const BULBS = Array.from({ length: 16 }, (_, i) => {
  const a = (i * 2 * Math.PI) / 16;
  return {
    left: +(50 + 47.6 * Math.sin(a)).toFixed(2),
    top: +(50 - 47.6 * Math.cos(a)).toFixed(2),
    odd: i % 2 === 1,
  };
});

/** Confettis de victoire (gauche %, délai s, durée s, couleur, rotation). */
const CONFETTI = [
  [6, 0, 1.6, "#F59E0B", 40],
  [14, 0.25, 1.9, "#FF2D7A", -60],
  [22, 0.1, 1.5, "#8A4DFF", 90],
  [30, 0.4, 2.0, "#14B8A6", -30],
  [38, 0.05, 1.7, "#6C2BD9", 70],
  [46, 0.32, 1.5, "#F59E0B", -80],
  [54, 0.15, 1.9, "#FF2D7A", 50],
  [62, 0.45, 1.6, "#0EA5E9", -45],
  [70, 0.08, 1.8, "#8A4DFF", 30],
  [78, 0.28, 1.5, "#F59E0B", -70],
  [86, 0.18, 2.0, "#FF2D7A", 60],
  [94, 0.38, 1.7, "#14B8A6", -50],
  [10, 0.55, 1.6, "#6C2BD9", 45],
  [34, 0.6, 1.8, "#FF2D7A", -35],
  [58, 0.52, 1.5, "#F59E0B", 85],
  [82, 0.65, 1.9, "#8A4DFF", -65],
  [26, 0.72, 1.6, "#0EA5E9", 25],
  [66, 0.78, 1.7, "#FF2D7A", -20],
] as const;

const WHEEL_CSS = `
@keyframes whTease{0%,100%{transform:rotate(-2.6deg)}50%{transform:rotate(2.6deg)}}
@keyframes whBulb{0%,100%{opacity:1;box-shadow:0 0 8px 2px rgba(255,255,255,.85)}50%{opacity:.25;box-shadow:none}}
@keyframes whGlow{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.95;transform:scale(1.045)}}
@keyframes whPtr{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-7deg)}}
@keyframes whSweep{0%{transform:translateX(-130%) skewX(-18deg)}100%{transform:translateX(230%) skewX(-18deg)}}
@keyframes whCta{0%,100%{transform:scale(1)}50%{transform:scale(1.02)}}
@keyframes whPop{0%{opacity:0;transform:scale(.72)}60%{opacity:1;transform:scale(1.05)}100%{opacity:1;transform:scale(1)}}
@keyframes whRays{from{transform:translateX(-50%) rotate(0deg)}to{transform:translateX(-50%) rotate(360deg)}}
@keyframes whConf{0%{transform:translateY(-16px) rotate(0deg);opacity:1}100%{transform:translateY(250px) rotate(560deg);opacity:0}}
.wh-tease{animation:whTease 3.2s ease-in-out infinite;transform-origin:50% 50%}
.wh-bulb{animation:whBulb 1.15s ease-in-out infinite}
.wh-bulb-b{animation-delay:.575s}
.wh-fast .wh-bulb{animation-duration:.32s}
.wh-glow{animation:whGlow 2.4s ease-in-out infinite}
.wh-ptr{animation:whPtr .3s ease-in-out infinite;transform-origin:50% 0}
.wh-sweep{animation:whSweep 2.6s ease-in-out infinite}
.wh-cta{animation:whCta 1.8s ease-in-out infinite}
.wh-pop{animation:whPop .45s cubic-bezier(.2,1.2,.3,1)}
.wh-rays{animation:whRays 7s linear infinite}
.wh-conf{animation:whConf var(--d,1.7s) ease-in var(--w,0s) forwards}
@media (prefers-reduced-motion:reduce){.wh-tease,.wh-bulb,.wh-glow,.wh-ptr,.wh-sweep,.wh-cta,.wh-rays,.wh-conf{animation:none}}
`;

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
        {/* Moyeu doré (style borne de jeu). */}
        <circle cx="150" cy="150" r="30" fill="#fff" />
        <circle
          cx="150"
          cy="150"
          r="26"
          fill="none"
          stroke="#F59E0B"
          strokeWidth="3"
        />
        <circle cx="150" cy="150" r="21" fill="#6C2BD9" />
        {/* Reflet doux en haut de la roue (profondeur). */}
        <circle cx="105" cy="85" r="120" fill="url(#whShineGrad)" />
        <defs>
          <radialGradient id="whShineGrad" cx="0.35" cy="0.25" r="0.7">
            <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
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

  const canPlay = !spinning && !spentToday;

  return (
    <div className="space-y-4">
      <style>{WHEEL_CSS}</style>

      {/* ── LA ROUE (habillage borne de jeu, style Temu/Shein) ── */}
      <div className="relative mx-auto w-full max-w-[330px]">
        {/* Halo pulsé derrière la roue tant qu'on peut jouer. */}
        <div
          aria-hidden
          className={cn(
            "absolute -inset-2 rounded-full bg-[radial-gradient(closest-side,rgba(255,45,122,.4),rgba(108,43,217,.22),transparent)] blur-md",
            canPlay && "wh-glow"
          )}
        />

        {/* Aiguille dorée (vibre pendant le tirage). */}
        <div className="absolute top-[-8px] left-1/2 z-20 -translate-x-1/2">
          <div className={cn(spinning && "wh-ptr")}>
            <div className="h-0 w-0 border-x-[17px] border-t-[27px] border-x-transparent border-t-[#F59E0B] drop-shadow-md" />
            <div className="absolute top-[2px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[19px] border-x-transparent border-t-[#FF2D7A]" />
          </div>
        </div>

        {/* Balancement d'attente (retiré dès le tirage pour un arrêt EXACT). */}
        <div className={cn(canPlay && "wh-tease")}>
          {/* Anneau lumineux : dégradé conique + ampoules clignotantes. */}
          <div
            className={cn(
              "relative aspect-square w-full rounded-full p-[13px] shadow-[0_22px_50px_-18px_rgba(76,27,155,.6)]",
              spinning && "wh-fast"
            )}
            style={{
              background:
                "conic-gradient(from 0deg, #6C2BD9, #FF2D7A, #F59E0B, #8A4DFF, #6C2BD9)",
            }}
          >
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {BULBS.map((b, i) => (
                <span
                  key={i}
                  className={cn(
                    "wh-bulb absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white",
                    b.odd && "wh-bulb-b"
                  )}
                  style={{ left: `${b.left}%`, top: `${b.top}%` }}
                />
              ))}
            </div>

            <div
              onTransitionEnd={onSpinEnd}
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: spinning
                  ? "transform 4.2s cubic-bezier(0.12, 0.8, 0.22, 1)"
                  : undefined,
              }}
              className="size-full rounded-full"
            >
              {wheelSvg}
            </div>
          </div>
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
          className={cn(
            "relative inline-flex h-[54px] w-full items-center justify-center gap-2 overflow-hidden rounded-[16px] text-base font-extrabold text-white shadow-[0_14px_30px_-10px_rgba(255,45,122,0.55)] transition active:scale-[0.98] disabled:opacity-70",
            !spinning && "wh-cta"
          )}
          style={{
            backgroundImage: "linear-gradient(92deg, #6C2BD9 0%, #FF2D7A 100%)",
          }}
        >
          {/* Balayage brillant en continu (style Temu). */}
          {!spinning && (
            <span
              aria-hidden
              className="wh-sweep pointer-events-none absolute inset-y-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent)]"
            />
          )}
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
            className="wh-pop bg-surface relative w-full max-w-[380px] overflow-hidden rounded-[26px] p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {result.kind === "voucher" ? (
              <>
                {/* Rayons dorés tournants derrière la célébration (Temu-like). */}
                <div
                  aria-hidden
                  className="wh-rays pointer-events-none absolute -top-14 left-1/2 size-72 -translate-x-1/2 rounded-full opacity-25 blur-[1px]"
                  style={{
                    background:
                      "repeating-conic-gradient(rgba(245,158,11,.9) 0deg 11deg, transparent 11deg 26deg)",
                  }}
                />
                {/* Pluie de confettis (déterministe, une seule fois). */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden"
                >
                  {CONFETTI.map(([l, w, d, c, r], i) => (
                    <span
                      key={i}
                      className="wh-conf absolute top-0 h-[10px] w-[7px] rounded-[2px]"
                      style={{
                        left: `${l}%`,
                        background: c,
                        rotate: `${r}deg`,
                        ["--w" as string]: `${w}s`,
                        ["--d" as string]: `${d}s`,
                      }}
                    />
                  ))}
                </div>
                <ColigoCelebration variant="verified" />
                <p className="text-foreground relative mt-2 text-xl font-extrabold">
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
