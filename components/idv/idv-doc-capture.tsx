"use client";

// =============================================================================
// IDV — capture GUIDÉE du document, plein écran (Portal → body, au-dessus de
// la nav). Caméra arrière, gabarit du document en surimpression, analyse
// temps réel de la zone du gabarit (netteté / lumière / reflets / stabilité)
// → messages de guidage + AUTO-CAPTURE quand tout est vert. Bouton manuel et
// repli « choisir une photo » toujours disponibles.
//
// Robustesse (mêmes règles que components/scanner/qr-scanner.tsx) :
//   • HTTPS obligatoire (isSecureContext) ;
//   • attendre loadedmetadata avant d'analyser ;
//   • boucle throttlée (~8 fps), pausée quand l'onglet est masqué ;
//   • cleanup strict au démontage (tracks + rAF).
// La photo envoyée = CROP de la zone du gabarit (résolution native, marge
// 6 %) : moins de fond, meilleure lecture OCR, moins de données inutiles.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, X, Zap } from "lucide-react";
import { Portal } from "@/components/ui/portal";

type Guidance =
  | "starting"
  | "too_dark"
  | "glare"
  | "blurry"
  | "moving"
  | "steady";

const GUIDANCE_FR: Record<Guidance, string> = {
  starting: "Démarrage de la caméra…",
  too_dark: "Ajoutez de la lumière",
  glare: "Évitez les reflets",
  blurry: "Rapprochez et stabilisez",
  moving: "Ne bougez plus…",
  steady: "Parfait, ne bougez plus",
};

/** Analyses consécutives « toutes vertes » avant le déclenchement auto. */
const STEADY_FRAMES = 6;
const ANALYSIS_FPS = 8;

export function IdvDocCapture({
  title,
  sideLabel,
  ratio,
  onCapture,
  onClose,
}: {
  /** Ex. « Carte nationale d'identité ». */
  title: string;
  /** Ex. « Recto » / « Verso » / « Page photo ». */
  sideLabel: string;
  /** Largeur / hauteur du gabarit (ID-1 ≈ 1.586, passeport ≈ 1.42). */
  ratio: number;
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const analysisRef = useRef<HTMLCanvasElement | null>(null);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const steadyCountRef = useRef(0);
  const capturedRef = useRef(false);

  const [phase, setPhase] = useState<"starting" | "live" | "denied">(
    "starting"
  );
  const [guidance, setGuidance] = useState<Guidance>("starting");
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [flash, setFlash] = useState(false);

  /** Rect du gabarit dans les COORDONNÉES VIDÉO natives (object-cover). */
  const guideRectInVideo = useCallback(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    const frame = frameRef.current;
    if (!video || !container || !frame || !video.videoWidth) return null;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
    const offsetX = (video.videoWidth * scale - cw) / 2;
    const offsetY = (video.videoHeight * scale - ch) / 2;
    const r = frame.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    return {
      x: (r.left - c.left + offsetX) / scale,
      y: (r.top - c.top + offsetY) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
  }, []);

  /** Capture : crop du gabarit (+6 % de marge) à la résolution native. */
  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const rect = guideRectInVideo();
    if (!video || !rect || capturedRef.current) return;
    capturedRef.current = true;
    setFlash(true);
    const margin = 0.06;
    const mx = rect.w * margin;
    const my = rect.h * margin;
    const sx = Math.max(0, rect.x - mx);
    const sy = Math.max(0, rect.y - my);
    const sw = Math.min(video.videoWidth - sx, rect.w + 2 * mx);
    const sh = Math.min(video.videoHeight - sy, rect.h + 2 * my);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    canvas
      .getContext("2d")!
      .drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
        else capturedRef.current = false;
      },
      "image/jpeg",
      0.92
    );
  }, [guideRectInVideo, onCapture]);

  // ── Caméra + boucle d'analyse ──────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let lastAnalysis = 0;
    let cancelled = false;

    const analyze = (now: number) => {
      raf = requestAnimationFrame(analyze);
      if (document.hidden || capturedRef.current) return;
      if (now - lastAnalysis < 1000 / ANALYSIS_FPS) return;
      lastAnalysis = now;

      const video = videoRef.current;
      const rect = guideRectInVideo();
      if (!video || !rect || video.readyState < 2) return;

      // Zone du gabarit réduite en ~128 px de large (niveaux de gris).
      const aw = 128;
      const ah = Math.max(16, Math.round((aw * rect.h) / rect.w));
      if (!analysisRef.current) {
        analysisRef.current = document.createElement("canvas");
      }
      const canvas = analysisRef.current;
      canvas.width = aw;
      canvas.height = ah;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, aw, ah);
      const { data } = ctx.getImageData(0, 0, aw, ah);

      const n = aw * ah;
      const gray = new Uint8ClampedArray(n);
      let sum = 0;
      let saturated = 0;
      for (let i = 0; i < n; i++) {
        const g =
          (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) /
          1000;
        gray[i] = g;
        sum += g;
        if (g >= 246) saturated++;
      }
      const brightness = sum / n;
      const glare = saturated / n;

      let lapAbs = 0;
      for (let y = 1; y < ah - 1; y++) {
        for (let x = 1; x < aw - 1; x++) {
          const i = y * aw + x;
          lapAbs += Math.abs(
            4 * gray[i] -
              gray[i - 1] -
              gray[i + 1] -
              gray[i - aw] -
              gray[i + aw]
          );
        }
      }
      const sharpness = lapAbs / ((aw - 2) * (ah - 2));

      let motion = 0;
      const prev = prevFrameRef.current;
      if (prev && prev.length === n) {
        let diff = 0;
        for (let i = 0; i < n; i += 4) diff += Math.abs(gray[i] - prev[i]);
        motion = diff / (n / 4);
      }
      prevFrameRef.current = gray;

      let next: Guidance;
      if (brightness < 55) next = "too_dark";
      else if (glare > 0.05) next = "glare";
      else if (sharpness < 7) next = "blurry";
      else if (motion > 9) next = "moving";
      else next = "steady";

      if (next === "steady") {
        steadyCountRef.current++;
        if (steadyCountRef.current >= STEADY_FRAMES) takePhoto();
      } else {
        steadyCountRef.current = 0;
      }
      setGuidance(next);
    };

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setPhase("denied");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
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
        const caps = stream
          .getVideoTracks()[0]
          ?.getCapabilities?.() as MediaTrackCapabilities & {
          torch?: boolean;
        };
        setHasTorch(Boolean(caps?.torch));
        setPhase("live");
        raf = requestAnimationFrame(analyze);
      } catch {
        setPhase("denied");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [guideRectInVideo, takePhoto]);

  const toggleTorch = useCallback(async () => {
    const video = videoRef.current;
    const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet],
      });
      setTorchOn((t) => !t);
    } catch {
      /* torche non supportée malgré les capabilities */
    }
  }, [torchOn]);

  /** Repli : photo choisie/prise via l'app appareil photo du téléphone. */
  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onCapture(file);
    },
    [onCapture]
  );

  const ready = phase === "live";

  return (
    <Portal>
      <div
        ref={containerRef}
        className="fixed inset-0 z-[90] flex flex-col bg-black"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
        />
        {flash && <div className="absolute inset-0 z-20 bg-white/80" />}

        {/* Assombrissement autour du gabarit. */}
        <div className="absolute inset-0 z-10 flex flex-col">
          <div className="flex-1 bg-black/55" />
          <div className="flex items-center">
            <div className="min-w-4 flex-1 self-stretch bg-black/55" />
            <div
              ref={frameRef}
              className="relative"
              style={{
                width: "min(88vw, 560px)",
                aspectRatio: String(ratio),
              }}
            >
              {/* coins du viseur */}
              {(
                [
                  "left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl",
                  "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl",
                  "left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl",
                  "right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl",
                ] as const
              ).map((pos) => (
                <span
                  key={pos}
                  className={`absolute h-8 w-8 ${pos} ${
                    guidance === "steady" && ready
                      ? "border-emerald-400"
                      : "border-white"
                  } transition-colors duration-200`}
                />
              ))}
            </div>
            <div className="min-w-4 flex-1 self-stretch bg-black/55" />
          </div>
          <div className="flex-[1.2] bg-black/55" />
        </div>

        {/* En-tête (safe area haut). */}
        <div className="relative z-30 flex items-start justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
          <div className="text-white">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-white/70">{sideLabel}</p>
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

        {/* Message de guidage. */}
        <div className="relative z-30 mt-auto flex flex-col items-center gap-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <span
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium backdrop-blur ${
              guidance === "steady" && ready
                ? "bg-emerald-500/90 text-white"
                : "bg-black/60 text-white"
            }`}
          >
            {ready ? GUIDANCE_FR[guidance] : GUIDANCE_FR.starting}
          </span>

          <div className="flex w-full items-center justify-center gap-8 px-8">
            {/* Repli fichier — toujours disponible. */}
            <label
              className="flex cursor-pointer flex-col items-center gap-1 text-[11px] text-white/80"
              aria-label="Choisir une photo"
            >
              <span className="rounded-full bg-white/15 p-3 backdrop-blur">
                <ImageIcon className="size-5 text-white" />
              </span>
              Photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={onPickFile}
              />
            </label>

            {/* Déclencheur manuel. */}
            <button
              type="button"
              onClick={takePhoto}
              disabled={!ready}
              aria-label="Prendre la photo"
              className="rounded-full border-4 border-white/90 bg-white/25 p-1 backdrop-blur transition-transform active:scale-95 disabled:opacity-40"
            >
              <span className="block size-14 rounded-full bg-white">
                {!ready && (
                  <Loader2 className="m-auto size-6 animate-spin text-black/60" />
                )}
              </span>
            </button>

            {/* Torche si dispo, sinon espace symétrique. */}
            {hasTorch ? (
              <button
                type="button"
                onClick={toggleTorch}
                aria-label="Torche"
                className={`flex flex-col items-center gap-1 text-[11px] ${
                  torchOn ? "text-amber-300" : "text-white/80"
                }`}
              >
                <span
                  className={`rounded-full p-3 backdrop-blur ${
                    torchOn ? "bg-amber-400/30" : "bg-white/15"
                  }`}
                >
                  <Zap className="size-5" />
                </span>
                Torche
              </button>
            ) : (
              <span className="w-[52px]" />
            )}
          </div>
        </div>

        {/* Caméra refusée / indisponible → repli photo seul. */}
        {phase === "denied" && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 px-8 text-center">
            <Camera className="size-10 text-white/70" />
            <p className="text-sm text-white">
              Caméra indisponible. Autorisez l&apos;accès dans les réglages, ou
              envoyez une photo.
            </p>
            <label className="cursor-pointer rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black">
              Prendre / choisir une photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={onPickFile}
              />
            </label>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-white/70 underline"
            >
              Annuler
            </button>
          </div>
        )}
      </div>
    </Portal>
  );
}
