"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, X } from "lucide-react";
import { cameraSupported } from "@/lib/native";
import { cn } from "@/lib/utils";

type Props = {
  /** Appelé à chaque détection (ou une seule fois si `oneShot`). */
  onScan: (text: string) => void;
  /** Si true, on s'arrête au premier scan. */
  oneShot?: boolean;
  /** Bouton fermer optionnel (affiché en haut à droite). */
  onClose?: () => void;
  /** Préfère la caméra arrière sur mobile (par défaut true). */
  preferBack?: boolean;
  className?: string;
};

type ZxingControls = { stop: () => void };
type DeviceInfo = { deviceId: string; label: string };

/**
 * Composant scanner QR réutilisable basé sur `@zxing/browser`.
 *
 * - caméra arrière par défaut (détection via le label du device)
 * - cadre central animé violet `#5C5CE0`
 * - bouton « changer de caméra » si plusieurs détectées
 * - gestion explicite des erreurs `NotAllowedError` / `NotFoundError`
 */
export function QrScanner({
  onScan,
  oneShot = true,
  onClose,
  preferBack = true,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ZxingControls | null>(null);
  const scannedRef = useRef(false);

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(
    undefined
  );
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  // Énumère les caméras pour proposer le toggle si plusieurs.
  useEffect(() => {
    if (!cameraSupported()) {
      setError("La caméra n'est pas disponible sur cet appareil.");
      setStarting(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Sans permission préalable, les labels sont vides ; ce n'est pas grave,
        // le décodeur ZXing utilisera la première caméra par défaut.
        const list = await navigator.mediaDevices.enumerateDevices();
        const cams = list
          .filter((d) => d.kind === "videoinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Caméra" }));
        if (cancelled) return;
        setDevices(cams);
        if (preferBack) {
          const back = cams.find((c) =>
            /back|rear|arrière|environment/i.test(c.label)
          );
          if (back) setActiveDeviceId(back.deviceId);
        }
      } catch {
        /* enumerateDevices peut échouer dans certains contextes — pas bloquant */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preferBack]);

  useEffect(() => {
    let cancelled = false;
    scannedRef.current = false;
    setStarting(true);
    setError(null);

    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(
          activeDeviceId,
          videoRef.current ?? undefined,
          (result) => {
            if (!result || scannedRef.current) return;
            const text = result.getText();
            if (oneShot) {
              scannedRef.current = true;
              controls.stop();
            }
            onScan(text);
          }
        );
        if (cancelled) controls.stop();
        else {
          controlsRef.current = controls;
          setStarting(false);
        }
      } catch (err) {
        if (cancelled) return;
        const e = err as { name?: string };
        if (e.name === "NotAllowedError")
          setError(
            "Accès à la caméra refusé. Vérifiez les permissions du navigateur."
          );
        else if (e.name === "NotFoundError")
          setError("Aucune caméra trouvée sur cet appareil.");
        else
          setError(
            "Impossible de démarrer la caméra. Réessayez ou changez de caméra."
          );
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [activeDeviceId, oneShot, onScan]);

  function switchCamera() {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === activeDeviceId);
    const next = devices[(idx + 1) % devices.length];
    setActiveDeviceId(next.deviceId);
  }

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

      {/* Cadre de scan + ligne animée */}
      <div className="pointer-events-none absolute inset-6 rounded-[12px] border-2 border-white/80">
        <span className="bg-primary-500 absolute -top-px -left-px size-5 rounded-tl-[12px]" />
        <span className="bg-primary-500 absolute -top-px -right-px size-5 rounded-tr-[12px]" />
        <span className="bg-primary-500 absolute -bottom-px -left-px size-5 rounded-bl-[12px]" />
        <span className="bg-primary-500 absolute -right-px -bottom-px size-5 rounded-br-[12px]" />
      </div>
      <div className="bg-primary-400/80 pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 animate-pulse" />

      {/* Boutons overlay (fermer / changer caméra) */}
      <div className="absolute top-2 right-2 flex gap-2">
        {devices.length > 1 && (
          <button
            type="button"
            onClick={switchCamera}
            aria-label="Changer de caméra"
            className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
          >
            <RefreshCw className="size-4" />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {(starting || error) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center text-white">
          {error ? (
            <>
              <Camera className="size-6 opacity-80" />
              <p className="text-sm">{error}</p>
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
