"use client";

// =============================================================================
// IDV — ÉCRAN D'ANALYSE (le moment « waouh » des grands acteurs de la
// vérification d'identité). Pendant que le serveur travaille, l'utilisateur
// voit SES contrôles s'égrener un à un, avec une animation de balayage.
//
// HONNÊTETÉ : le rythme d'apparition est cosmétique (le serveur ne stream pas
// son avancement), MAIS les VERDICTS affichés à la fin sont les VRAIS — ceux
// renvoyés par l'action (`checks`). Tant que la réponse n'est pas là, un
// contrôle reste « en cours » : on n'affiche jamais un ✓ qui n'existe pas.
// =============================================================================

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldQuestion, X } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import type { IdvCheckSummary } from "@/app/idv/actions";

export type ScanPhase = "document" | "selfie";

/** Contrôles ANNONCÉS pour chaque phase, dans l'ordre où on les montre. */
const PHASE_CHECKS: Record<ScanPhase, { key: string; label: string }[]> = {
  document: [
    { key: "doc_quality", label: "Netteté et lumière" },
    { key: "doc_face", label: "Portrait sur le document" },
    { key: "mrz", label: "Zone lisible par machine" },
    { key: "ocr_extract", label: "Lecture des informations" },
    { key: "doc_expiry", label: "Validité du document" },
  ],
  selfie: [
    { key: "liveness_active", label: "Présence réelle" },
    { key: "liveness_passive", label: "Détection d'écran ou de photo" },
    { key: "face_match", label: "Comparaison avec le document" },
  ],
};

/** Cadence d'apparition (ms) — l'analyse réelle dure ~3-6 s. */
const REVEAL_MS = 900;

export function IdvScanOverlayStyles() {
  return (
    <style>{`
      @keyframes idv-sweep {
        0%   { transform: translateY(-120%); opacity: 0; }
        15%  { opacity: 1; }
        85%  { opacity: 1; }
        100% { transform: translateY(120%); opacity: 0; }
      }
      @keyframes idv-row-in {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes idv-pop-check {
        0%   { transform: scale(0); }
        60%  { transform: scale(1.25); }
        100% { transform: scale(1); }
      }
      @keyframes idv-ring-spin { to { transform: rotate(360deg); } }
      .idv-sweep { animation: idv-sweep 1.8s ease-in-out infinite; }
      .idv-row   { animation: idv-row-in .32s ease-out both; }
      .idv-check { animation: idv-pop-check .3s cubic-bezier(.22,1,.36,1); }
      .idv-ring  { animation: idv-ring-spin 1.1s linear infinite; }
      @media (prefers-reduced-motion: reduce) {
        .idv-sweep, .idv-row, .idv-check, .idv-ring { animation: none; }
      }
    `}</style>
  );
}

export function IdvScanOverlay({
  phase,
  /** Aperçu analysé (document ou selfie) — data URL locale. */
  previewUrl,
  /** Résultats RÉELS ; null tant que le serveur n'a pas répondu. */
  results,
  /** Le serveur a répondu par un refus reprenable (message). */
  errorMessage,
  onDone,
}: {
  phase: ScanPhase;
  previewUrl: string | null;
  results: IdvCheckSummary[] | null;
  errorMessage?: string | null;
  onDone: () => void;
}) {
  const items = PHASE_CHECKS[phase];
  const [revealed, setRevealed] = useState(1);

  // Révélation progressive tant que l'analyse tourne ; à l'arrivée des
  // résultats, on montre tout d'un coup.
  useEffect(() => {
    if (results) {
      setRevealed(items.length);
      return;
    }
    const t = setInterval(
      () => setRevealed((n) => Math.min(items.length, n + 1)),
      REVEAL_MS
    );
    return () => clearInterval(t);
  }, [results, items.length]);

  // Résultats affichés → on laisse une seconde de lecture puis on rend la main.
  useEffect(() => {
    if (!results) return;
    const t = setTimeout(onDone, 1400);
    return () => clearTimeout(t);
  }, [results, onDone]);

  const statusOf = (key: string) =>
    results?.find((r) => r.key === key)?.status ?? null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[95] flex flex-col items-center justify-center px-6"
        style={{ background: "rgba(8,6,16,.94)" }}
      >
        <IdvScanOverlayStyles />

        {/* Aperçu avec ligne de balayage. */}
        {previewUrl && (
          <div className="relative mb-6 w-full max-w-[300px] overflow-hidden rounded-[18px] border border-white/20">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob local */}
            <img
              src={previewUrl}
              alt=""
              aria-hidden
              className="w-full opacity-80"
            />
            {!results && (
              <div className="pointer-events-none absolute inset-0">
                <div
                  className="idv-sweep absolute inset-x-0 h-1/3"
                  style={{
                    background:
                      "linear-gradient(180deg, transparent, rgba(139,92,246,.55), transparent)",
                  }}
                />
              </div>
            )}
          </div>
        )}

        <p className="mb-4 text-center text-base font-bold text-white">
          {results
            ? errorMessage
              ? "Analyse terminée"
              : "Analyse réussie"
            : phase === "document"
              ? "Analyse du document…"
              : "Vérification en cours…"}
        </p>

        {/* Liste des contrôles. */}
        <ul className="w-full max-w-[320px] space-y-2">
          {items.slice(0, revealed).map((item, i) => {
            const st = statusOf(item.key);
            return (
              <li
                key={item.key}
                className="idv-row flex items-center gap-2.5 rounded-[12px] bg-white/[.07] px-3 py-2.5"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {st === null && (
                    <Loader2 className="idv-ring size-4 text-white/70" />
                  )}
                  {st === "passed" && (
                    <Check
                      className="idv-check size-4"
                      style={{ color: "#34d399" }}
                    />
                  )}
                  {st === "failed" && (
                    <X
                      className="idv-check size-4"
                      style={{ color: "#f87171" }}
                    />
                  )}
                  {(st === "skipped" || st === "error") && (
                    <ShieldQuestion className="size-4 text-white/40" />
                  )}
                </span>
                <span
                  className="text-sm"
                  style={{
                    color:
                      st === "failed"
                        ? "#fca5a5"
                        : st === "skipped" || st === "error"
                          ? "rgba(255,255,255,.45)"
                          : "rgba(255,255,255,.92)",
                  }}
                >
                  {item.label}
                </span>
                {(st === "skipped" || st === "error") && (
                  <span className="ml-auto text-[10px] text-white/40">
                    non applicable
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {results && errorMessage && (
          <p className="mt-4 max-w-[320px] text-center text-sm text-red-300">
            {errorMessage}
          </p>
        )}
      </div>
    </Portal>
  );
}
