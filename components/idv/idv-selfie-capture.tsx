"use client";

// =============================================================================
// IDV — capture SELFIE avec défis liveness (étape 6), plein écran (Portal).
// Caméra FRONTALE, aperçu MIROIR (naturel pour l'utilisateur) mais frames
// capturées NON-MIROIR (la géométrie serveur en dépend). Le client n'évalue
// RIEN : il affiche la consigne, compte à rebours, capture — le serveur juge
// (lib/idv/liveness.ts). Pas de repli fichier ici : une photo importée
// détruirait le principe même du contrôle de présence.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ScanFace,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Check } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import { IdvStepper } from "./idv-stepper";
import type { IdvChallenge } from "@/lib/idv/liveness";

/** Animations locales (reduced-motion géré). */
function SelfieStyles() {
  return (
    <style>{`
      @keyframes idv-instr-in {
        from { opacity: 0; transform: translateY(8px) scale(.96); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes idv-count-pop {
        0%   { transform: scale(1.5); opacity: 0; }
        40%  { transform: scale(1); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes idv-burst {
        0%   { transform: scale(.5); opacity: .8; }
        100% { transform: scale(1.8); opacity: 0; }
      }
      @keyframes idv-tick {
        0%   { transform: scale(0); }
        60%  { transform: scale(1.2); }
        100% { transform: scale(1); }
      }
      .idv-instr { animation: idv-instr-in .34s cubic-bezier(.22,1,.36,1); }
      .idv-count { animation: idv-count-pop .35s cubic-bezier(.22,1,.36,1); }
      .idv-burst { animation: idv-burst .6s ease-out; }
      .idv-tick  { animation: idv-tick .32s cubic-bezier(.22,1,.36,1); }
      @media (prefers-reduced-motion: reduce) {
        .idv-instr, .idv-count, .idv-burst, .idv-tick { animation: none; }
      }
    `}</style>
  );
}

// Les flèches gauche/droite sont des directions PHYSIQUES (tête de
// l'utilisateur) : elles ne se retournent JAMAIS en RTL.
const CHALLENGE_UI: Record<
  IdvChallenge,
  {
    icon: typeof ScanFace;
    label: string;
    labelAr: string;
    hint: string;
    hintAr: string;
  }
> = {
  center: {
    icon: ScanFace,
    label: "Placez votre visage dans l'ovale",
    labelAr: "ضع وجهك داخل الإطار البيضاوي",
    hint: "Regardez l'objectif",
    hintAr: "انظر إلى العدسة",
  },
  turn_left: {
    icon: ArrowLeft,
    label: "Tournez la tête à gauche",
    labelAr: "أدر رأسك إلى اليسار",
    hint: "Puis restez ainsi",
    hintAr: "ثم ابقَ هكذا",
  },
  turn_right: {
    icon: ArrowRight,
    label: "Tournez la tête à droite",
    labelAr: "أدر رأسك إلى اليمين",
    hint: "Puis restez ainsi",
    hintAr: "ثم ابقَ هكذا",
  },
  closer: {
    icon: ZoomIn,
    label: "Rapprochez le téléphone",
    labelAr: "قرّب الهاتف",
    hint: "Visage plus grand dans l'ovale",
    hintAr: "اجعل وجهك أكبر داخل الإطار",
  },
  farther: {
    icon: ZoomOut,
    label: "Éloignez le téléphone",
    labelAr: "أبعد الهاتف",
    hint: "Visage plus petit, mais entier",
    hintAr: "اجعل وجهك أصغر مع بقائه كاملًا",
  },
};

const COUNTDOWN_S = 3;
const CAPTURE_MAX_WIDTH = 960;

export function IdvSelfieCapture({
  challenges,
  onDone,
  onClose,
}: {
  challenges: IdvChallenge[];
  /** Frames JPEG NON-MIROIR, dans l'ordre des défis. */
  onDone: (frames: Blob[]) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const framesRef = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<"starting" | "live" | "denied">(
    "starting"
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [flash, setFlash] = useState(false);
  /** Relance le compte du défi courant (frame indisponible). */
  const [retry, setRetry] = useState(0);
  /** Salve verte affichée quand un défi vient d'être capturé. */
  const [burst, setBurst] = useState(false);

  // ── Caméra frontale ────────────────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setPhase("denied");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current!;
        video.srcObject = stream;
        await new Promise<void>((resolve) => {
          if (video.readyState >= 1) return resolve();
          video.addEventListener("loadedmetadata", () => resolve(), {
            once: true,
          });
        });
        await video.play();
        setPhase("live");
      } catch {
        setPhase("denied");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /** Capture la frame courante, NON-miroir, réduite à ≤ 960 px de large. */
  const capture = useCallback((): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return Promise.resolve(null);
    const scale = Math.min(1, CAPTURE_MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas
      .getContext("2d")!
      .drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9)
    );
  }, []);

  // ── Machine à défis : consigne → compte à rebours → capture → suivant ────
  // Décompte porté par une variable LOCALE (jamais d'effet de bord dans un
  // updater React : StrictMode les double-invoque → double capture).
  useEffect(() => {
    if (phase !== "live" || stepIndex >= challenges.length) return;
    let remaining = COUNTDOWN_S;
    let finished = false;
    setCountdown(remaining);
    const interval = setInterval(() => {
      if (document.hidden || finished) return; // arrière-plan : pause
      remaining -= 1;
      setCountdown(remaining);
      if (remaining > 0) return;
      finished = true;
      clearInterval(interval);
      void (async () => {
        setFlash(true);
        const blob = await capture();
        setTimeout(() => setFlash(false), 150);
        if (blob) {
          framesRef.current[stepIndex] = blob;
          // Confirmation visuelle du défi accompli avant de passer au suivant.
          setBurst(true);
          setTimeout(() => setBurst(false), 620);
          if (stepIndex + 1 >= challenges.length) {
            setTimeout(() => onDone([...framesRef.current]), 650);
          } else {
            setTimeout(() => setStepIndex(stepIndex + 1), 650);
          }
        } else {
          setRetry((r) => r + 1); // relance le compte de CE défi
        }
      })();
    }, 1000);
    return () => {
      finished = true;
      clearInterval(interval);
    };
  }, [phase, stepIndex, retry, challenges.length, capture, onDone]);

  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const challenge = challenges[Math.min(stepIndex, challenges.length - 1)];
  const ui = CHALLENGE_UI[challenge];
  const uiLabel = isAr ? ui.labelAr : ui.label;
  const uiHint = isAr ? ui.hintAr : ui.hint;
  const Icon = ui.icon;

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] flex flex-col bg-black">
        <SelfieStyles />
        {/* Aperçu MIROIR (naturel) — la capture, elle, reste non-miroir. */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        />
        {flash && <div className="absolute inset-0 z-20 bg-white/80" />}

        {/* Masque ovale + ANNEAU DE PROGRESSION : un segment par défi, qui
            passe au vert dès qu'il est accompli. L'utilisateur voit sa
            vérification avancer sur son propre visage. */}
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            <div
              className={`h-[46vh] w-[76vw] max-w-[420px] rounded-[50%] border-2 transition-colors duration-300 ${
                burst ? "border-emerald-400" : "border-white/80"
              }`}
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,.55)" }}
            />

            {/* Segments de progression, posés autour de l'ovale. */}
            <div className="absolute -top-5 flex gap-1.5">
              {challenges.map((c, i) => (
                <span
                  key={c + i}
                  className="h-1.5 w-10 rounded-full transition-colors duration-300"
                  style={{
                    background:
                      i < stepIndex || (i === stepIndex && burst)
                        ? "#34d399"
                        : i === stepIndex
                          ? "rgba(255,255,255,.85)"
                          : "rgba(255,255,255,.28)",
                  }}
                />
              ))}
            </div>

            {/* Salve verte + coche : le défi vient d'être validé. */}
            {burst && (
              <span className="absolute flex items-center justify-center">
                <span className="idv-burst absolute size-40 rounded-full bg-emerald-400/35" />
                <span className="idv-tick flex size-16 items-center justify-center rounded-full bg-emerald-500 shadow-lg">
                  <Check className="size-9 text-white" strokeWidth={3} />
                </span>
              </span>
            )}
          </div>
        </div>

        {/* En-tête + fil d'Ariane (visible par-dessus la caméra). */}
        <div className="relative z-30 px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
          <div className="flex items-start justify-between">
            <div className="text-white">
              <p className="text-sm font-semibold">
                {tr("Selfie de vérification", "سيلفي التحقّق")}
              </p>
              <p className="text-xs text-white/70">
                {tr("Geste", "الحركة")}{" "}
                {Math.min(stepIndex + 1, challenges.length)} {tr("sur", "من")}{" "}
                {challenges.length}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tr("Fermer", "إغلاق")}
              className="rounded-full bg-white/15 p-2 text-white backdrop-blur"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="mt-3">
            <IdvStepper
              current="selfie"
              hint={
                phase === "live"
                  ? uiLabel
                  : tr("Démarrage de la caméra…", "جارٍ تشغيل الكاميرا…")
              }
              progress={
                challenges.length
                  ? (stepIndex + (burst ? 1 : 0)) / challenges.length
                  : 0
              }
              onDark
            />
          </div>
        </div>

        {/* Consigne + compte à rebours. */}
        <div className="relative z-30 mt-auto flex flex-col items-center gap-3 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          {phase === "live" && !burst && (
            <>
              <div
                key={`instr-${stepIndex}`}
                className="idv-instr flex items-center gap-3 rounded-2xl bg-black/65 px-4 py-3 text-white backdrop-blur"
              >
                <Icon className="size-7 shrink-0 animate-pulse" />
                <div>
                  <p className="text-sm font-semibold">{uiLabel}</p>
                  <p className="text-xs text-white/70">{uiHint}</p>
                </div>
              </div>
              <span
                key={`${stepIndex}-${countdown}`}
                className="idv-count text-4xl font-bold text-white tabular-nums drop-shadow"
              >
                {countdown > 0 ? countdown : ""}
              </span>
            </>
          )}
          {phase === "live" && burst && (
            <span className="rounded-full bg-emerald-500/90 px-3.5 py-1.5 text-sm font-medium text-white">
              {tr("Parfait", "ممتاز")}
            </span>
          )}
          {phase === "starting" && (
            <span className="rounded-full bg-black/60 px-3.5 py-1.5 text-sm text-white backdrop-blur">
              {tr("Démarrage de la caméra…", "جارٍ تشغيل الكاميرا…")}
            </span>
          )}
        </div>

        {/* Caméra refusée : PAS de repli fichier (le liveness l'exige). */}
        {phase === "denied" && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 px-8 text-center">
            <Camera className="size-10 text-white/70" />
            <p className="text-sm text-white">
              {tr(
                "Caméra indisponible. Le selfie de vérification nécessite la caméra — autorisez l'accès dans les réglages puis réessayez.",
                "الكاميرا غير متاحة. سيلفي التحقّق يتطلب الكاميرا — اسمح بالوصول في الإعدادات ثم أعد المحاولة."
              )}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black"
            >
              {tr("Fermer", "إغلاق")}
            </button>
          </div>
        )}
      </div>
    </Portal>
  );
}
