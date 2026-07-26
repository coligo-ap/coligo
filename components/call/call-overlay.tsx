"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Video,
  VideoOff,
  SwitchCamera,
} from "lucide-react";
import { Portal } from "@/components/ui/portal";

// =============================================================================
// CallOverlay — fenêtre d'appel in-app plein écran (Agora RTC).
//
// • Audio-first : on rejoint et publie le micro tout de suite (ultra léger,
//   passe sur la 3G/4G algérienne). La VIDÉO est OPTIONNELLE : un bouton
//   « Caméra » publie/retire la piste vidéo à la demande (le client peut
//   montrer la rue au chauffeur). Le SDK Agora adapte le débit tout seul → sur
//   mauvaise connexion la qualité baisse, l'appel ne coupe pas.
// • Le SDK (agora-rtc-sdk-ng) est chargé en import() dynamique (browser-only,
//   lourd) UNIQUEMENT quand un appel démarre — zéro impact sur le reste de
//   l'app, rien sur Vercel/Supabase (le média passe par le réseau Agora).
// • Numéros masqués par nature : aucun numéro de téléphone n'est échangé.
// =============================================================================

// Types minimaux (on évite d'importer les types lourds du SDK au build).
type AnyTrack = {
  setMuted?: (m: boolean) => Promise<void> | void;
  setEnabled?: (e: boolean) => Promise<void> | void;
  play?: (el?: HTMLElement) => void;
  stop?: () => void;
  close?: () => void;
};
type RemoteUser = {
  uid: number | string;
  audioTrack?: { play: () => void };
  videoTrack?: { play: (el: HTMLElement) => void; stop: () => void };
};
type RtcClient = {
  join: (
    appId: string,
    channel: string,
    token: string,
    uid: number
  ) => Promise<number>;
  publish: (tracks: AnyTrack[]) => Promise<void>;
  unpublish: (tracks: AnyTrack[]) => Promise<void>;
  leave: () => Promise<void>;
  subscribe: (user: RemoteUser, mediaType: "audio" | "video") => Promise<void>;
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
  removeAllListeners: () => void;
};

export function CallOverlay({
  callId,
  kind = "ride",
  role,
  peerName,
  startWithVideo,
  onEnd,
}: {
  /** Id de l'objet appelé : rideId (course) ou orderId (commande). */
  callId: string;
  /** "ride" = course Drive ; "order" = commande (commerçant → client). */
  kind?: "ride" | "order";
  role: string;
  peerName: string;
  /** Démarrer caméra allumée (sinon audio seul, cam activable au bouton). */
  startWithVideo?: boolean;
  /** Appelé quand l'appel se termine (raccroché localement, pair parti, erreur). */
  onEnd: () => void;
}) {
  // Libellés FR/AR (composant partagé client AR/FR ↔ chauffeur FR).
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [status, setStatus] = useState<
    "connecting" | "ringing" | "active" | "error"
  >("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(!!startWithVideo);
  const [remoteVideo, setRemoteVideo] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);

  // Réfs mutables des objets SDK (pas dans le state — pas de re-render).
  const sdkRef = useRef<{ AgoraRTC: unknown } | null>(null);
  const clientRef = useRef<RtcClient | null>(null);
  const micRef = useRef<AnyTrack | null>(null);
  const camRef = useRef<AnyTrack | null>(null);
  const facingRef = useRef<"user" | "environment">("environment");
  const endedRef = useRef(false);

  // ─── Connexion initiale : rejoindre + publier le micro ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("agora-rtc-sdk-ng");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AgoraRTC: any = mod.default ?? mod;
        if (cancelled) return;
        sdkRef.current = { AgoraRTC };

        // Jeton + canal sécurisés (la route vérifie que je suis bien PARTIE à
        // la course / à la commande demandée).
        const res = await fetch("/api/agora/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            kind === "order"
              ? { orderId: callId, role }
              : { rideId: callId, role }
          ),
        });
        if (!res.ok) throw new Error("token_" + res.status);
        const { appId, channel, uid, token } = (await res.json()) as {
          appId: string;
          channel: string;
          uid: number;
          token: string;
        };
        if (cancelled) return;

        const client: RtcClient = AgoraRTC.createClient({
          mode: "rtc",
          codec: "vp8",
        });
        clientRef.current = client;

        // Pair publie une piste → on s'abonne et on joue.
        client.on("user-published", async (...args: unknown[]) => {
          const user = args[0] as RemoteUser;
          const mediaType = args[1] as "audio" | "video";
          try {
            await client.subscribe(user, mediaType);
            if (mediaType === "audio") user.audioTrack?.play();
            if (mediaType === "video" && remoteVideoRef.current) {
              user.videoTrack?.play(remoteVideoRef.current);
              setRemoteVideo(true);
            }
            setStatus("active");
          } catch {
            /* ignore */
          }
        });
        client.on("user-unpublished", (...args: unknown[]) => {
          const mediaType = args[1] as "audio" | "video";
          if (mediaType === "video") setRemoteVideo(false);
        });
        // Pair a quitté = il a raccroché.
        client.on("user-left", () => end());

        await client.join(appId, channel, token, uid);

        // Micro tout de suite (audio-first).
        micRef.current = await AgoraRTC.createMicrophoneAudioTrack();
        await client.publish([micRef.current as AnyTrack]);

        // Caméra si démarrage vidéo demandé.
        if (startWithVideo) await enableCam(true);

        if (!cancelled) setStatus((s) => (s === "active" ? s : "ringing"));
      } catch (e) {
        if (cancelled) return;
        const msg = String((e as Error)?.message ?? e);
        setErrorMsg(
          msg.includes("Permission") || msg.includes("NotAllowed")
            ? tr(
                "Micro/caméra refusés. Autorise l'accès puis réessaie.",
                "تم رفض الميكروفون/الكاميرا. اسمح بالوصول ثم أعد المحاولة."
              )
            : msg.startsWith("token_403")
              ? tr(
                  "Appel non autorisé pour cette course.",
                  "المكالمة غير مسموحة لهذه الرحلة."
                )
              : tr(
                  "Connexion à l'appel impossible. Vérifie ta connexion.",
                  "تعذّر الاتصال بالمكالمة. تحقّق من اتصالك."
                )
        );
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      void teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chrono d'appel une fois actif.
  useEffect(() => {
    if (status !== "active") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  async function enableCam(on: boolean) {
    const AgoraRTC = (sdkRef.current as { AgoraRTC: unknown } | null)
      ?.AgoraRTC as
      | { createCameraVideoTrack: (cfg?: unknown) => Promise<AnyTrack> }
      | undefined;
    const client = clientRef.current;
    if (!AgoraRTC || !client) return;
    try {
      if (on) {
        // Qualité HD (720p) + bitrate ADAPTATIF (Agora ajuste seul entre
        // bitrateMin/Max selon le réseau → HD quand ça passe, dégradation
        // propre sinon, sans coupure). `optimizationMode: "detail"` =
        // préférence de dégradation « maintien de la résolution » (on baisse le
        // débit/framerate avant de chuter brutalement la netteté de l'image,
        // adapté à un appel face-à-face). Les contraintes width/height en
        // `ideal` poussent getUserMedia à CAPTURER en 1280×720 (sans ça la
        // webcam est ouverte en basse résolution → image floue).
        const cam = await AgoraRTC.createCameraVideoTrack({
          facingMode: facingRef.current,
          optimizationMode: "detail",
          encoderConfig: {
            width: { ideal: 1280, min: 640, max: 1920 },
            height: { ideal: 720, min: 480, max: 1080 },
            frameRate: { ideal: 24, min: 15, max: 30 },
            bitrateMin: 600,
            bitrateMax: 2200,
          },
        });
        camRef.current = cam;
        await client.publish([cam]);
        if (localVideoRef.current) cam.play?.(localVideoRef.current);
        setCamOn(true);
      } else {
        if (camRef.current) {
          await client.unpublish([camRef.current]);
          camRef.current.stop?.();
          camRef.current.close?.();
          camRef.current = null;
        }
        setCamOn(false);
      }
    } catch {
      setCamOn(false);
    }
  }

  async function switchCamera() {
    // Recrée la piste caméra avec l'autre objectif (avant/arrière).
    facingRef.current =
      facingRef.current === "environment" ? "user" : "environment";
    if (camRef.current) {
      await enableCam(false);
      await enableCam(true);
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    void micRef.current?.setMuted?.(next);
  }

  async function teardown() {
    try {
      if (camRef.current) {
        camRef.current.stop?.();
        camRef.current.close?.();
        camRef.current = null;
      }
      if (micRef.current) {
        micRef.current.stop?.();
        micRef.current.close?.();
        micRef.current = null;
      }
      clientRef.current?.removeAllListeners();
      await clientRef.current?.leave();
    } catch {
      /* ignore */
    } finally {
      clientRef.current = null;
    }
  }

  function end() {
    if (endedRef.current) return;
    endedRef.current = true;
    void teardown();
    onEnd();
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const statusLabel =
    status === "active"
      ? `${mm}:${ss}`
      : status === "error"
        ? tr("Échec", "فشل")
        : tr("Connexion…", "جارٍ الاتصال…");

  return (
    <Portal>
      <div className="fixed inset-0 z-[200] flex flex-col bg-[#0d0b18] text-white">
        {/* Vidéo distante plein écran (si le pair a la cam) */}
        <div
          ref={remoteVideoRef}
          className="absolute inset-0 bg-[#0d0b18]"
          style={{ display: remoteVideo ? "block" : "none" }}
        />

        {/* En-tête : qui + statut/chrono */}
        <div className="relative z-10 flex flex-col items-center pt-[calc(2.5rem+env(safe-area-inset-top))]">
          {!remoteVideo && (
            <div className="mt-10 grid size-24 place-items-center rounded-full bg-white/10 text-4xl font-black">
              {peerName.charAt(0).toUpperCase()}
            </div>
          )}
          <p className="mt-4 text-xl font-extrabold">{peerName}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-white/70">
            {status === "connecting" && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            {statusLabel}
          </p>
          {errorMsg && (
            <p className="mx-6 mt-3 rounded-xl bg-red-500/20 px-3 py-2 text-center text-[13px] font-semibold text-red-200">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Vidéo locale en PiP (si cam allumée) */}
        <div
          ref={localVideoRef}
          className="absolute top-[calc(2.5rem+env(safe-area-inset-top))] right-3 z-20 h-40 w-28 overflow-hidden rounded-2xl border border-white/15 bg-black/40"
          style={{ display: camOn ? "block" : "none" }}
        />

        {/* Barre d'actions */}
        <div className="relative z-10 mt-auto flex items-center justify-center gap-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
          {status !== "error" && (
            <>
              <CallBtn
                onClick={toggleMute}
                active={muted}
                label={muted ? tr("Activer", "إلغاء الكتم") : tr("Muet", "كتم")}
              >
                {muted ? (
                  <MicOff className="size-6" />
                ) : (
                  <Mic className="size-6" />
                )}
              </CallBtn>

              <CallBtn
                onClick={() => void enableCam(!camOn)}
                active={camOn}
                label={tr("Caméra", "الكاميرا")}
              >
                {camOn ? (
                  <Video className="size-6" />
                ) : (
                  <VideoOff className="size-6" />
                )}
              </CallBtn>

              {camOn && (
                <CallBtn
                  onClick={() => void switchCamera()}
                  label={tr("Pivoter", "تبديل الكاميرا")}
                >
                  <SwitchCamera className="size-6" />
                </CallBtn>
              )}
            </>
          )}

          {/* Raccrocher */}
          <button
            type="button"
            onClick={end}
            aria-label={tr("Raccrocher", "إنهاء المكالمة")}
            className="grid size-16 place-items-center rounded-full bg-red-600 shadow-lg transition active:scale-95"
          >
            <PhoneOff className="size-7" />
          </button>
        </div>
      </div>
    </Portal>
  );
}

function CallBtn({
  children,
  onClick,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={
        "grid size-14 place-items-center rounded-full transition active:scale-95 " +
        (active ? "bg-white text-[#0d0b18]" : "bg-white/15 text-white")
      }
    >
      {children}
    </button>
  );
}
