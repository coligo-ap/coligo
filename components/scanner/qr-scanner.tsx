"use client";

/**
 * Scanner QR — caméra qui s'ouvre AUTOMATIQUEMENT au mount du composant
 * (pas de bouton « Activer »). Auto-détecte le QR, le décode, le passe à
 * `onScan`.
 *
 * Robustesse — addresse les causes habituelles de « la caméra ne détecte
 * rien » + « l'APK quitte quand la caméra s'ouvre » sur Sunmi V3 :
 *
 *  1. **HTTPS obligatoire** : `getUserMedia` échoue silencieusement sur
 *     HTTP. On check `window.isSecureContext` d'entrée.
 *
 *  2. **Crash WebView Sunmi sur BarcodeDetector** : sur le WebView Chromium
 *     embarqué dans l'APK Capacitor Sunmi V3, l'API `BarcodeDetector` est
 *     exposée mais son implémentation native peut crasher le process
 *     WebView entier → l'APK quitte. On DÉSACTIVE le BarcodeDetector dès
 *     qu'on détecte un environnement Capacitor natif (`Capacitor.isNativePlatform()`)
 *     et on force `@zxing/browser` (JavaScript pur, pas de risque de
 *     crash natif). En PWA navigateur, on garde BarcodeDetector pour la
 *     perf.
 *
 *  3. **Attente vidéo prête** : on attend `loadedmetadata` + `readyState >= 2`
 *     avant de lancer la boucle de détection. Appeler `detector.detect(video)`
 *     sur une vidéo qui n'a pas encore de frame chargée peut crasher le
 *     décodeur natif.
 *
 *  4. **Boucle de scan throttlée** : 10 fps via `requestAnimationFrame`.
 *
 *  5. **Anti-doublon** : 1.5s de cooldown sur le même contenu détecté.
 *
 *  6. **Cleanup strict** : au démontage, `track.stop()` + `cancelAnimationFrame`.
 *
 *  7. **Logs structurés via console.info** : visibles via
 *     `adb logcat -s chromium:* Capacitor:*` pour diagnostiquer le
 *     pipeline en cas de bug Sunmi.
 *
 * On pause la boucle en arrière-plan (`visibilitychange`).
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

/**
 * Détecte si on tourne dans un WebView Capacitor natif (APK Android, iOS).
 * Sur Sunmi V3, c'est le cas — et `BarcodeDetector` y crashe le process
 * WebView. On force zxing dans ce cas.
 */
function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  try {
    return w.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** Log structuré pour logcat (visible via `adb logcat -s chromium:*`). */
function log(event: string, payload?: Record<string, unknown>) {
  try {
    if (typeof console === "undefined") return;
    const data = payload ? JSON.stringify(payload) : "";
    console.info(`[qr-scanner] ${event} ${data}`);
  } catch {
    /* ignored */
  }
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

    const nativeCap = isCapacitorNative();
    log("mount", {
      capacitorNative: nativeCap,
      isSecureContext:
        typeof window !== "undefined" ? window.isSecureContext : null,
      hasGUM:
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia,
      hasBarcodeDetector:
        typeof window !== "undefined" &&
        !!(window as { BarcodeDetector?: unknown }).BarcodeDetector,
      ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });

    (async () => {
      try {
        // 1. HTTPS check
        if (typeof window !== "undefined" && !window.isSecureContext) {
          log("abort.not-secure-context");
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
          log("abort.no-camera-api");
          setStatus("unsupported");
          setErrMessage(
            "Ce navigateur ne supporte pas l'accès caméra. Utilisez la saisie manuelle."
          );
          return;
        }

        // 2. getUserMedia (caméra arrière, fallback toute caméra dispo)
        let stream: MediaStream;
        try {
          log("gum.request", { facingMode: "environment" });
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
          log("gum.ok");
        } catch (err) {
          const name = (err as { name?: string })?.name ?? "";
          log("gum.failed-1", { name });
          if (
            name === "OverconstrainedError" ||
            name === "ConstraintNotSatisfiedError" ||
            name === "NotFoundError"
          ) {
            try {
              log("gum.retry-without-constraints");
              stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
              });
              log("gum.retry-ok");
            } catch (err2) {
              if (abort) return;
              const e = classifyGumError(err2);
              log("gum.failed-2", { name: (err2 as { name?: string })?.name });
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

        // 3. Attache le stream au <video> et attend une frame
        const video = videoRef.current;
        if (!video) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;

        // Attente que la 1ère frame soit chargée AVANT de lancer la
        // détection — sinon `detect(video)` peut crasher le décodeur natif.
        // `loadedmetadata` est plus fiable que `loadeddata` sur certains
        // WebViews ; on combine avec un timeout de sécurité.
        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) {
            resolve();
            return;
          }
          const onReady = () => {
            video.removeEventListener("loadedmetadata", onReady);
            video.removeEventListener("loadeddata", onReady);
            resolve();
          };
          video.addEventListener("loadedmetadata", onReady);
          video.addEventListener("loadeddata", onReady);
          // Garde-fou 3s : si rien ne fire (driver caméra bizarre),
          // on continue quand même.
          setTimeout(resolve, 3000);
        });

        try {
          await video.play();
          log("video.playing", {
            w: video.videoWidth,
            h: video.videoHeight,
            readyState: video.readyState,
          });
        } catch (err) {
          log("video.play-failed", {
            name: (err as { name?: string })?.name,
          });
          /* certains UA refusent play() — on continue avec zxing */
        }

        // 4. Choix du moteur de décodage
        //    - Capacitor natif → ZXING uniquement (BarcodeDetector crashe
        //      le WebView Sunmi V3 et fait quitter l'APK).
        //    - PWA navigateur → BarcodeDetector si supporté, sinon zxing.
        const det = nativeCap ? null : getBarcodeDetector();
        let useNative = false;
        if (det) {
          try {
            const formats = (await det.Static.getSupportedFormats?.()) ?? [];
            useNative = formats.includes("qr_code");
          } catch {
            useNative = false;
          }
        }
        log("engine.choice", {
          engine: useNative ? "BarcodeDetector" : "zxing",
          reason: nativeCap
            ? "capacitor-native (skip BarcodeDetector)"
            : useNative
              ? "qr_code supported"
              : "fallback",
        });

        if (abort || stoppedRef.current) return;

        if (useNative && det) {
          let detector: BarcodeDetectorInstance;
          try {
            detector = new det.Ctor({ formats: ["qr_code"] });
          } catch (err) {
            log("barcode-detector.ctor-failed", {
              name: (err as { name?: string })?.name,
            });
            await startZxing(video);
            return;
          }
          setStatus("scanning");

          let lastFrameAt = 0;
          const tick = async (ts: number) => {
            if (stoppedRef.current) return;
            if (ts - lastFrameAt >= 100) {
              lastFrameAt = ts;
              try {
                if (video.readyState >= 2) {
                  const results = await detector.detect(video);
                  if (results.length > 0 && results[0].rawValue) {
                    log("decoded", { engine: "native" });
                    emit(results[0].rawValue);
                  }
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
      } catch (err) {
        // Filet de sécurité GLOBAL : aucun throw non géré ne doit faire
        // crasher le composant. Sur Sunmi un throw async non-catché peut
        // déclencher un crash WebView en cascade.
        log("fatal", {
          name: (err as { name?: string })?.name,
          msg: err instanceof Error ? err.message : String(err),
        });
        if (abort) return;
        setStatus("error");
        setErrMessage(
          "Erreur scanner. Utilisez la saisie manuelle du code à 6 chiffres."
        );
      }
    })();

    // Boucle zxing (toujours dispo, utilisée systématiquement sur Capacitor)
    async function startZxing(video: HTMLVideoElement) {
      try {
        log("zxing.start");
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoElement(
          video,
          (result) => {
            if (stoppedRef.current || !result) return;
            const text = result.getText();
            if (text) {
              log("decoded", { engine: "zxing" });
              emit(text);
            }
          }
        );
        if (stoppedRef.current) {
          controls.stop();
          return;
        }
        zxingRef.current = controls;
        setStatus("scanning");
        log("zxing.ready");
      } catch (err) {
        log("zxing.failed", {
          msg: err instanceof Error ? err.message : String(err),
        });
        setStatus("error");
        setErrMessage("Décodeur QR indisponible. Utilisez la saisie manuelle.");
      }
    }

    return () => {
      abort = true;
      log("unmount");
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
