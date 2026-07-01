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

/**
 * Crée un lecteur zxing configuré pour la détection QR la PLUS agressive :
 *  - `TRY_HARDER` : zxing tente rotations/échelles/binarisations multiples →
 *    détecte un QR même petit, incliné, légèrement flou ou faiblement
 *    contrasté (sans ce hint, le décodeur ne lit qu'un QR net et bien cadré,
 *    d'où le symptôme « le QR n'est jamais détecté »).
 *  - `POSSIBLE_FORMATS: [QR_CODE]` : on ne cherche QUE des QR → moins de
 *    travail parasite par frame, détection plus rapide.
 * Retourne `null` si l'import échoue (repli géré par l'appelant).
 */
async function makeZxingReader(): Promise<
  import("@zxing/browser").BrowserQRCodeReader | null
> {
  try {
    const [{ BrowserQRCodeReader }, { DecodeHintType, BarcodeFormat }] =
      await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
    const hints = new Map<number, unknown>();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    return new BrowserQRCodeReader(hints);
  } catch (err) {
    log("zxing.import-failed", {
      msg: err instanceof Error ? err.message : String(err),
    });
    return null;
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

export function QrScanner({
  onScan,
  oneShot = true,
  onClose,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
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
              frameRate: { ideal: 30 },
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

        // 4. Boucle de décodage par CANVAS (plus fiable cross-device que de
        //    passer le <video> directement aux décodeurs : on maîtrise le
        //    dimensionnement et l'extraction de frame). Moteurs :
        //    - Capacitor natif → ZXING uniquement (BarcodeDetector crashe le
        //      WebView Sunmi V3 et fait quitter l'APK).
        //    - PWA navigateur → BarcodeDetector(canvas) si supporté, sinon zxing.
        const det = nativeCap ? null : getBarcodeDetector();
        let nativeDetector: BarcodeDetectorInstance | null = null;
        if (det) {
          try {
            const formats = (await det.Static.getSupportedFormats?.()) ?? [];
            if (formats.includes("qr_code")) {
              nativeDetector = new det.Ctor({ formats: ["qr_code"] });
            }
          } catch {
            nativeDetector = null;
          }
        }

        // zxing : fallback (PWA sans BarcodeDetector) ET moteur natif Capacitor.
        // Configuré TRY_HARDER (cf. makeZxingReader) pour une détection robuste.
        let zxingReader: import("@zxing/browser").BrowserQRCodeReader | null =
          null;
        if (!nativeDetector) {
          zxingReader = await makeZxingReader();
          if (!zxingReader) {
            if (abort) return;
            setStatus("error");
            setErrMessage(
              "Décodeur QR indisponible. Utilisez la saisie manuelle."
            );
            return;
          }
        }

        log("engine.choice", {
          engine: nativeDetector ? "BarcodeDetector(video)" : "zxing(canvas)",
          reason: nativeCap
            ? "capacitor-native (skip BarcodeDetector)"
            : nativeDetector
              ? "qr_code supported"
              : "fallback",
        });

        if (abort || stoppedRef.current) return;

        // Canvas de travail (hors DOM) — on y dessine chaque frame avant décodage.
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setStatus("error");
          setErrMessage(
            "Décodeur QR indisponible. Utilisez la saisie manuelle."
          );
          return;
        }

        setStatus("scanning");

        let lastFrameAt = 0;
        let loggedFirstFrame = false;
        // Nombre d'échecs CONSÉCUTIFS de BarcodeDetector.detect(). Sur certains
        // navigateurs l'API existe mais `detect()` throw à chaque frame (impl
        // native cassée) — sans repli, le scanner ne détecterait JAMAIS rien.
        // Au-delà du seuil, on bascule à chaud sur zxing.
        let nativeFailStreak = 0;
        const vfc = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: (now: number) => void) => number;
        };
        const schedule = (cb: (ts: number) => void) => {
          if (stoppedRef.current) return;
          if (typeof vfc.requestVideoFrameCallback === "function") {
            vfc.requestVideoFrameCallback((now) => cb(now));
          } else {
            rafRef.current = requestAnimationFrame(cb);
          }
        };
        const tick = async (ts: number) => {
          if (stoppedRef.current) return;
          // Cadence de DÉCODAGE (recalculée : on peut basculer native→zxing à
          // chaud) :
          //  - BarcodeDetector (PWA, accéléré matériel) → CHAQUE frame caméra ;
          //  - zxing (APK Sunmi / repli, CPU pur) → ~14 fps (espacé, TRY_HARDER
          //    est plus lourd mais l'await pace naturellement la boucle).
          const minInterval = nativeDetector ? 0 : 70;
          if (
            ts - lastFrameAt >= minInterval &&
            video.readyState >= 2 &&
            video.videoWidth > 0
          ) {
            lastFrameAt = ts;
            try {
              if (nativeDetector) {
                // On passe le <video> DIRECTEMENT (pas de canvas) : plus rapide,
                // pleine résolution native → meilleure détection. Sûr ici car ce
                // moteur n'est JAMAIS utilisé en Capacitor natif (cf. plus haut).
                if (!loggedFirstFrame) {
                  loggedFirstFrame = true;
                  log("frame.first", {
                    w: video.videoWidth,
                    h: video.videoHeight,
                    engine: "native",
                  });
                }
                try {
                  const results = await nativeDetector.detect(video);
                  nativeFailStreak = 0;
                  if (results.length > 0 && results[0].rawValue) {
                    log("decoded", { engine: "native" });
                    emit(results[0].rawValue);
                  }
                } catch (err) {
                  // detect() cassé sur ce navigateur → bascule à chaud sur zxing.
                  nativeFailStreak += 1;
                  if (nativeFailStreak >= 3) {
                    log("native.detect-broken → fallback zxing", {
                      msg: err instanceof Error ? err.message : String(err),
                    });
                    nativeDetector = null;
                    zxingReader = await makeZxingReader();
                    if (!zxingReader && !stoppedRef.current) {
                      setStatus("error");
                      setErrMessage(
                        "Décodeur QR indisponible. Utilisez la saisie manuelle."
                      );
                      return;
                    }
                  }
                }
              } else if (zxingReader) {
                // Dessine la frame (capée à 720 px sur le grand côté : assez de
                // modules pour un QR même petit, sans plomber le CPU Sunmi).
                const vw = video.videoWidth;
                const vh = video.videoHeight;
                const scale = Math.min(1, 720 / Math.max(vw, vh));
                canvas.width = Math.max(1, Math.round(vw * scale));
                canvas.height = Math.max(1, Math.round(vh * scale));
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                if (!loggedFirstFrame) {
                  loggedFirstFrame = true;
                  log("frame.first", {
                    w: canvas.width,
                    h: canvas.height,
                    engine: "zxing",
                  });
                }
                // decodeFromCanvas lève NotFoundException si aucun QR : normal,
                // on enchaîne sur la frame suivante.
                try {
                  const res = zxingReader.decodeFromCanvas(canvas);
                  const text = res?.getText();
                  if (text) {
                    log("decoded", { engine: "zxing" });
                    emit(text);
                  }
                } catch {
                  /* pas de QR sur cette frame */
                }
              }
            } catch {
              /* frame indisponible : on continue */
            }
          }
          schedule(tick);
        };
        schedule(tick);
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
