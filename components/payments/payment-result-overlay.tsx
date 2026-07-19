"use client";

import { useEffect } from "react";
import { Check, Clock3, Loader2, X } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import { haptic } from "@/lib/native/haptics";

// =============================================================================
// PaymentResultOverlay — expérience de résultat de paiement NATIVE, premium.
// =============================================================================
// Plein écran, ancré par-dessus l'app (le client ne quitte jamais Coligo).
// Cinq états, façon Apple Wallet / Revolut : traitement, réussi, échoué,
// annulé, expiré — avec animations CSS et retour haptique (succès / erreur).
// Réutilisable par TOUT flux de paiement (recharge, checkout, abonnement…).
// Thémé (clair/sombre) via tokens sémantiques + fallback couleurs de marque.
// =============================================================================

export type PaymentResultState =
  | "processing"
  | "success"
  | "failed"
  | "cancelled"
  | "expired";

const OVERLAY_CSS = `
:root{--pay-bg:#fff;--pay-ink:#0b0c12;--pay-muted:#6b7280;--pay-line:rgba(0,0,0,.12);--pay-go:#16b364;--pay-red:#e5484d;--pay-violet:#6c2bd9}
.theme-dark{--pay-bg:#0b0c12;--pay-ink:#fff;--pay-muted:#9ca0b3;--pay-line:rgba(255,255,255,.16)}
@keyframes cg-pay-pop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
@keyframes cg-pay-ring{0%{transform:scale(.7);opacity:.6}100%{transform:scale(1.5);opacity:0}}
@keyframes cg-pay-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
@keyframes cg-pay-up{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion: reduce){.cg-pay-ic,.cg-pay-txt{animation:none!important}}
`;

export function PaymentResultOverlay({
  state,
  title,
  sub,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  state: PaymentResultState;
  title: string;
  sub?: string;
  /** Action principale (ex. « Retour au portefeuille » / « Réessayer »). */
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  // Haptique à l'entrée d'un état terminal (une fois par changement d'état).
  useEffect(() => {
    if (state === "success") haptic("success");
    else if (state === "failed" || state === "expired") haptic("error");
  }, [state]);

  const ok = state === "success";
  const processing = state === "processing";
  const bad =
    state === "failed" || state === "cancelled" || state === "expired";

  const accent = ok
    ? "var(--pay-go, #16b364)"
    : bad
      ? "var(--pay-red, #e5484d)"
      : "var(--pay-violet, #6c2bd9)";

  return (
    <Portal>
      <style>{OVERLAY_CSS}</style>
      <div
        role="alertdialog"
        aria-live="assertive"
        className="fixed inset-0 z-[150] flex flex-col items-center justify-center px-8 text-center"
        style={{
          background: "var(--pay-bg, #ffffff)",
          color: "var(--pay-ink, #0b0c12)",
          paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)",
        }}
      >
        {/* Icône d'état */}
        <div className="relative mb-6 grid place-items-center">
          {ok && (
            <span
              className="cg-pay-ic absolute inset-0 rounded-full"
              style={{
                animation: "cg-pay-ring .8s ease-out forwards",
                background: accent,
              }}
            />
          )}
          <span
            className="cg-pay-ic relative grid size-24 place-items-center rounded-full"
            style={{
              background: processing ? "transparent" : `${accent}1f`,
              color: accent,
              animation: processing
                ? undefined
                : bad
                  ? "cg-pay-shake .5s ease"
                  : "cg-pay-pop .5s cubic-bezier(.16,1,.3,1)",
            }}
          >
            {processing ? (
              <Loader2 className="size-12 animate-spin" />
            ) : ok ? (
              <Check className="size-12" strokeWidth={3} />
            ) : state === "expired" ? (
              <Clock3 className="size-12" strokeWidth={2.5} />
            ) : (
              <X className="size-12" strokeWidth={3} />
            )}
          </span>
        </div>

        <div className="cg-pay-txt" style={{ animation: "cg-pay-up .4s ease" }}>
          <h2 className="text-[22px] font-extrabold tracking-[-0.5px]">
            {title}
          </h2>
          {sub && (
            <p
              className="mx-auto mt-2 max-w-xs text-[13.5px] leading-snug font-medium"
              style={{ color: "var(--pay-muted, #6b7280)" }}
            >
              {sub}
            </p>
          )}
        </div>

        {/* Actions (masquées pendant le traitement) */}
        {!processing && (onPrimary || onSecondary) && (
          <div
            className="mt-8 w-full max-w-xs space-y-2.5"
            style={{ animation: "cg-pay-up .5s ease" }}
          >
            {onPrimary && primaryLabel && (
              <button
                type="button"
                onClick={onPrimary}
                className="w-full rounded-[16px] py-3.5 text-[15px] font-extrabold text-white"
                style={{ background: accent }}
              >
                {primaryLabel}
              </button>
            )}
            {onSecondary && secondaryLabel && (
              <button
                type="button"
                onClick={onSecondary}
                className="w-full rounded-[16px] py-3 text-[14px] font-bold"
                style={{
                  border: "1.5px solid var(--pay-line, rgba(0,0,0,.12))",
                  color: "var(--pay-ink, #0b0c12)",
                }}
              >
                {secondaryLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </Portal>
  );
}
