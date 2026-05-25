"use client";

/**
 * Scanner QR — caméra qui s'ouvre AUTOMATIQUEMENT au mount du composant
 * (pas de bouton « Activer »). Auto-détecte le QR, le décode, le passe à
 * `onScan`. C'est l'UX visée : le commerçant pose son téléphone face au
 * ticket, ça scanne, c'est validé.
 *
 * Robustesse — addresse les 5 causes habituelles de « la caméra ne détecte
 * rien » :
 *
 *  1. **HTTPS obligatoire** : `getUserMedia` échoue silencieusement sur
 *     HTTP. On check `window.isSecureContext` d'entrée et on affiche un
 *     message explicite si KO.
 *
 *  2. **Double moteur de décodage** :
 *     - `BarcodeDetector` natif si supporté (Android Chrome ≥ 88,
 *       matériellement accéléré). C'est ce qui détecte réellement les QR
 *       sur Sunmi V3.
 *     - Fallback `@zxing/browser` (iOS Safari, Firefox).
 *
 *  3. **Boucle de scan throttlée** : 10 fps via `requestAnimationFrame`.
 *     Beaucoup de scanners affichent la vidéo sans lancer la détection.
 *     Ici on vérifie chaque ~100ms.
 *
 *  4. **Anti-doublon** : 1.5s de cooldown sur le même contenu détecté
 *     pour éviter de re-firer `onScan` 30 fois par seconde.
 *
 *  5. **Cleanup strict** : au démontage, `track.stop()` sur chaque
 *     MediaStreamTrack + `cancelAnimationFrame`. La diode caméra ne
 *     reste pas allumée.
 *
 * On pause aussi la boucle en arrière-plan (`visibilitychange`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Appelé à chaque détection (ou une seule fois si `oneShot`). */
  onScan: (text: string) => void;
  /** Si true, on stoppe la caméra au premier scan utile. Défaut : true. */
  oneShot?: boolean;
  /** Bouton fermer optionnel (affiché en haut à droite). */
  onClose?: () => void;
  className?: string;
};

type Status = "starting" | "scanning" | "error" | "unsupported";
type ScannerErrorKind =
  | "not-secure-context"
  | "no-camera-api"
  | "permission-denied"
  | "no-camera-found"
  | "camera-busy"
  | "decoder-failed"
  | "unknown";

// ─── BarcodeDetector typings (pas dans lib.dom.d.ts en 2026) ─────────────
type DetectedBarcode = { rawValue: string; format: string };
type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = new (opts?: {
  formats?: string[];
}) => BarcodeDetectorInstance;
type BarcodeDetectorStatic = {
  getSupportedFormats?: () => Promise<string[]>;
};

function getBarcodeDetector(): {
  Ctor: BarcodeDetectorCtor;
  Static: BarcodeDetectorStatic;
} | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    BarcodeDetector?: BarcodeDetectorCtor & BarcodeDetectorStatic;
  };
  if (!w.BarcodeDetector) return null;
  return { Ctor: w.BarcodeDetector, Static: w.BarcodeDetector };
}

function classifyGumError(err: unknown): {
  kind: ScannerErrorKind;
  message: string;
} {
  const name = (err as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "permission-denied",
        message:
          "Accès caméra refusé. Autorisez Coligo dans les réglages du navigateur.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        kind: "no-camera-found",
        message: "Aucune caméra trouvée sur cet appareil.",
      };
    case "NotReadableError":
    case "AbortError":
      return {
        kind: "camera-busy",
        message:
          "La caméra est déjà utilisée par une autre application. Fermez-la et réessayez.",
      };
    default:
      return {
        kind: "unknown",
        message:
          "Impossible de démarrer la caméra. Utilisez la saisie manuelle.",
      };
  }
}

type ZxingControls = { stop: () => void };

export function QrScanner({
  onScan,
  oneShot = true,
  onClose,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingRef = useRef<ZxingControls | null>(null);
  const stoppedRef = useRef(false);
  const scannedRef = useRef(false);
  const lastDetectionRef = useRef<{ text: string; at: number } | null>(null);
  const onScanRef = useRef(onScan);

  // Garde une ref vers le callback courant : on évite de remonter la boucle
  // chaque fois que le parent recrée la fonction `onScan` inline.
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const [status, setStatus] = useState<Status>("starting");
  const [errMessage, setErrMessage] = useState<string | null>(null);

  /** Émet vers onScan en respectant cooldown anti-doublon + oneShot. */
  const emit = useCallback(
    (text: string) => {
      if (oneShot && scannedRef.current) return;
      const now = Date.now();
      const last = lastDetectionRef.current;
      if (last && last.text === text && now - last.at < 1500) return;
      lastDetectionRef.current = { text, at: now };
      if (oneShot) scannedRef.current = true;
      onScanRef.current(text);
    },
    [oneShot]
  );

  /** Coupe tout. Idempotent. */
  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (zxingRef.current) {
      try {
        zxingRef.current.stop();
      } catch {
        /* ignored */
      }
      zxingRef.current = null;
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignored */
        }
      }
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {
        /* ignored */
      }
      v.srcObject = null;
    }
  }, []);

  // ─── Démarrage AUTO au mount ────────────────────────────────────────────
  useEffect(() => {
    stoppedRef.current = false;
    scannedRef.current = false;
    let abort = false;

    (async () => {
      // 1. HTTPS check (échec silencieux de getUserMedia sinon)
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setStatus("unsupported");
        setErrMessage(
          "La caméra nécessite une connexion sécurisée HTTPS. Utilisez la saisie manuelle."
        );
        return;
      }
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setStatus("unsupported");
        setErrMessage(
          "Ce navigateur ne supporte pas l'accès caméra. Utilisez la saisie manuelle."
        );
        return;
      }

      // 2. getUserMedia (caméra arrière)
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        // OverconstrainedError → retente sans contraintes
        const name = (err as { name?: string })?.name ?? "";
        if (
          name === "OverconstrainedError" ||
          name === "ConstraintNotSatisfiedError"
        ) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } catch (err2) {
            if (abort) return;
            const e = classifyGumError(err2);
            setStatus("error");
            setErrMessage(e.message);
            return;
          }
        } else {
          if (abort) return;
          const e = classifyGumError(err);
          setStatus("error");
          setErrMessage(e.message);
          return;
        }
      }

      if (abort || stoppedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      streamRef.current = stream;

      // 3. Attache le stream au <video>
      const video = videoRef.current;
      if (!video) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      try {
        await video.play();
      } catch {
        /* certains UA refusent play() — on continue avec rAF/zxing */
      }

      // 4. Choix du moteur : BarcodeDetector natif si dispo, sinon zxing
      const det = getBarcodeDetector();
      let useNative = false;
      if (det) {
        try {
          const formats = (await det.Static.getSupportedFormats?.()) ?? [];
          useNative = formats.includes("qr_code");
        } catch {
          useNative = false;
        }
      }

      if (abort || stoppedRef.current) return;

      if (useNative && det) {
        // Boucle native rAF throttlée à ~10 fps
        let detector: BarcodeDetectorInstance;
        try {
          detector = new det.Ctor({ formats: ["qr_code"] });
        } catch {
          // Fallback zxing si l'instanciation plante
          return startZxing(video);
        }
        setStatus("scanning");

        let lastFrameAt = 0;
        const tick = async (ts: number) => {
          if (stoppedRef.current) return;
          if (ts - lastFrameAt >= 100) {
            lastFrameAt = ts;
            try {
              const results = await detector.detect(video);
              if (results.length > 0 && results[0].rawValue) {
                emit(results[0].rawValue);
              }
            } catch {
              /* frame pas prête : on continue */
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } else {
        await startZxing(video);
      }
    })();

    // Boucle zxing (fallback iOS Safari / Firefox)
    async function startZxing(video: HTMLVideoElement) {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoElement(
          video,
          (result) => {
            if (stoppedRef.current || !result) return;
            const text = result.getText();
            if (text) emit(text);
          }
        );
        if (stoppedRef.current) {
          controls.stop();
          return;
        }
        zxingRef.current = controls;
        setStatus("scanning");
      } catch {
        setStatus("error");
        setErrMessage("Décodeur QR indisponible. Utilisez la saisie manuelle.");
      }
    }

    return () => {
      abort = true;
      cleanup();
    };
    // emit et cleanup sont stables (useCallback sans deps changeantes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause en arrière-plan : on coupe tout. Au retour au premier plan,
  // le composant n'auto-redémarre PAS (le scanner serait alors fantôme) —
  // l'utilisateur referme/rouvre la page validate s'il en a besoin.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) cleanup();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [cleanup]);

  const isFailed = status === "error" || status === "unsupported";

  return (
    <div
      className={cn(
        "relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-[16px] bg-black",
        className
      )}
    >
      <video
        ref={videoRef}
        className="size-full object-cover"
        muted
        playsInline
        autoPlay
      />

      {/* Cadre de visée */}
      <div className="pointer-events-none absolute inset-6 rounded-[12px] border-2 border-white/80">
        <span className="bg-primary-500 absolute -top-px -left-px size-5 rounded-tl-[12px]" />
        <span className="bg-primary-500 absolute -top-px -right-px size-5 rounded-tr-[12px]" />
        <span className="bg-primary-500 absolute -bottom-px -left-px size-5 rounded-bl-[12px]" />
        <span className="bg-primary-500 absolute -right-px -bottom-px size-5 rounded-br-[12px]" />
      </div>
      <div className="bg-primary-400/80 pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 animate-pulse" />

      {onClose && (
        <button
          type="button"
          onClick={() => {
            cleanup();
            onClose();
          }}
          aria-label="Fermer le scanner"
          className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
        >
          <X className="size-4" />
        </button>
      )}

      {/* Overlay : démarrage / erreur */}
      {(status === "starting" || isFailed) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 px-6 text-center text-white">
          {isFailed ? (
            <>
              <Camera className="size-7 opacity-90" />
              <p className="text-sm leading-snug">
                {errMessage ?? "Caméra indisponible."}
              </p>
            </>
          ) : (
            <>
              <Loader2 className="size-6 animate-spin" />
              <p className="text-sm opacity-80">Démarrage de la caméra…</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
