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
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ScanFace,
  X,
  ZoomIn,
} from "lucide-react";
import { Portal } from "@/components/ui/portal";
import type { IdvChallenge } from "@/lib/idv/liveness";

const CHALLENGE_UI: Record<
  IdvChallenge,
  { icon: typeof ScanFace; label: string; hint: string }
> = {
  center: {
    icon: ScanFace,
    label: "Placez votre visage dans l'ovale",
    hint: "Regardez l'objectif",
  },
  turn_left: {
    icon: ArrowLeft,
    label: "Tournez la tête à gauche",
    hint: "Puis restez ainsi",
  },
  turn_right: {
    icon: ArrowRight,
    label: "Tournez la tête à droite",
    hint: "Puis restez ainsi",
  },
  closer: {
    icon: ZoomIn,
    label: "Rapprochez le téléphone",
    hint: "Visage plus grand dans l'ovale",
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
          if (stepIndex + 1 >= challenges.length) {
            onDone([...framesRef.current]);
          } else {
            setStepIndex(stepIndex + 1);
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

  const challenge = challenges[Math.min(stepIndex, challenges.length - 1)];
  const ui = CHALLENGE_UI[challenge];
  const Icon = ui.icon;

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] flex flex-col bg-black">
        {/* Aperçu MIROIR (naturel) — la capture, elle, reste non-miroir. */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        />
        {flash && <div className="absolute inset-0 z-20 bg-white/80" />}

        {/* Masque ovale. */}
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div
            className="h-[46vh] w-[76vw] max-w-[420px] rounded-[50%] border-2 border-white/80"
            style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,.55)" }}
          />
        </div>

        {/* En-tête. */}
        <div className="relative z-30 flex items-start justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
          <div className="text-white">
            <p className="text-sm font-semibold">Selfie de vérification</p>
            <p className="text-xs text-white/70">
              Étape {Math.min(stepIndex + 1, challenges.length)} /{" "}
              {challenges.length}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-full bg-white/15 p-2 text-white backdrop-blur"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Consigne + compte à rebours. */}
        <div className="relative z-30 mt-auto flex flex-col items-center gap-3 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          {phase === "live" && (
            <>
              <div className="flex items-center gap-3 rounded-2xl bg-black/60 px-4 py-3 text-white backdrop-blur">
                <Icon className="size-7 shrink-0 animate-pulse" />
                <div>
                  <p className="text-sm font-semibold">{ui.label}</p>
                  <p className="text-xs text-white/70">{ui.hint}</p>
                </div>
              </div>
              <span
                key={`${stepIndex}-${countdown}`}
                className="text-4xl font-bold text-white tabular-nums drop-shadow"
              >
                {countdown > 0 ? countdown : ""}
              </span>
            </>
          )}
          {phase === "starting" && (
            <span className="rounded-full bg-black/60 px-3.5 py-1.5 text-sm text-white backdrop-blur">
              Démarrage de la caméra…
            </span>
          )}
        </div>

        {/* Caméra refusée : PAS de repli fichier (le liveness l'exige). */}
        {phase === "denied" && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 px-8 text-center">
            <Camera className="size-10 text-white/70" />
            <p className="text-sm text-white">
              Caméra indisponible. Le selfie de vérification nécessite la caméra
              — autorisez l&apos;accès dans les réglages puis réessayez.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black"
            >
              Fermer
            </button>
          </div>
        )}
      </div>
    </Portal>
  );
}
