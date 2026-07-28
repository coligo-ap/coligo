/**
 * Reconnaissance vocale (ar-DZ / fr-FR) — dictée pour l'assistant Drive.
 *
 * CHAÎNE (« ça doit marcher partout ») :
 *  1. APK/iOS Capacitor : enregistrement MediaRecorder (getUserMedia) puis
 *     TRANSCRIPTION SERVEUR (Groq Whisper, action transcribeDriveAudio) —
 *     chemin PRINCIPAL sur mobile : contrôlé de bout en bout, arrêt auto au
 *     silence, et Whisper comprend darija/ar/fr bien mieux que l'ASR Android.
 *  2. Navigateur : Web Speech API (partiels en direct) ; toute erreur de
 *     service (network/service-not-allowed…) bascule sur l'enregistreur.
 *  3. Dernier recours (WebView sans getUserMedia) : plugin natif
 *     `@capacitor-community/speech-recognition` via le pont
 *     `window.Capacitor.Plugins.SpeechRecognition` (PAS d'import → bundle
 *     web propre). ⚠️ Sémantique piégeuse : avec `partialResults: true`, son
 *     `start()` se résout IMMÉDIATEMENT (sans matches) et les erreurs natives
 *     sont AVALÉES (reject sur un call déjà résolu) → il faut vivre sur les
 *     événements `partialResults` + `listeningState` et des garde-fous temps.
 *
 * Tout est best-effort + dégradation gracieuse : si rien n'est dispo,
 * `speechSupported()` renvoie false et l'UI masque le micro.
 */

import { isNative } from "./context";
import { transcribeDriveAudio } from "@/app/(customer)/drive/transcribe-actions";

export type SpeechLang = "ar-DZ" | "fr-FR";

export type SpeechHandle = { stop: () => void };

type SpeechOpts = {
  lang: SpeechLang;
  /** Transcription en direct (interim). */
  onPartial?: (text: string) => void;
  /** Texte final reconnu. */
  onFinal: (text: string) => void;
  /** "denied" | "unsupported" | "no-speech" | "error" | … */
  onError?: (kind: string) => void;
  onEnd?: () => void;
};

/* ───────────────────────── Pont natif ───────────────────────── */

type NativeSpeechPlugin = {
  available?: () => Promise<{ available: boolean }>;
  requestPermissions?: () => Promise<{ speechRecognition?: string }>;
  start: (opts: {
    language?: string;
    partialResults?: boolean;
    popup?: boolean;
    maxResults?: number;
  }) => Promise<{ matches?: string[] }>;
  stop: () => Promise<void>;
  addListener: (
    event: string,
    cb: (data: { matches?: string[] }) => void
  ) => Promise<{ remove: () => void }> | { remove: () => void };
};

function nativePlugin(): NativeSpeechPlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (
    window as unknown as {
      Capacitor?: { Plugins?: { SpeechRecognition?: NativeSpeechPlugin } };
    }
  ).Capacitor;
  return cap?.Plugins?.SpeechRecognition ?? null;
}

/* ───────────────────────── Web Speech API ───────────────────────── */

function webRecCtor(): (new () => WebSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => WebSpeechRecognition;
    webkitSpeechRecognition?: new () => WebSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type WebSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: WebSpeechEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type WebSpeechEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

/* ───────────────────────── API publique ───────────────────────── */

/** Enregistreur + transcription serveur disponibles ? (repli universel). */
function recorderSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (recorderSupported()) return true;
  if (!isNative() && webRecCtor()) return true;
  return !!(isNative() && nativePlugin());
}

export async function startSpeech(opts: SpeechOpts): Promise<SpeechHandle> {
  // Navigateur : Web Speech (partiels en direct, repli enregistreur intégré).
  if (!isNative() && webRecCtor()) return startWeb(opts);
  // Mobile (APK/iOS) et navigateurs sans Web Speech : enregistreur + Whisper.
  if (recorderSupported()) return startRecorder(opts);
  // WebView exotique sans getUserMedia : plugin natif en dernier recours.
  if (isNative() && nativePlugin()) return startNative(opts);
  opts.onError?.("unsupported");
  return { stop() {} };
}

/* ─────────── Repli universel : MediaRecorder + Whisper serveur ─────────── */

/** Format d'enregistrement supporté par CE navigateur/WebView. */
function pickRecorderMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* continue */
    }
  }
  return "";
}

/**
 * Détection de silence (arrêt AUTOMATIQUE de la dictée) : analyse RMS du flux
 * micro via WebAudio. Dès qu'on a entendu de la voix (≥ ~600 ms cumulées),
 * ~1,8 s de silence déclenche l'arrêt → même confort que l'ASR native (parler
 * puis se taire suffit, pas besoin de re-taper le micro). Best-effort : sans
 * AudioContext, on garde le tap-pour-arrêter + le plafond 15 s.
 */
function watchSilence(stream: MediaStream, onSilence: () => void) {
  type AC = typeof AudioContext;
  const Ctor =
    (window as unknown as { AudioContext?: AC; webkitAudioContext?: AC })
      .AudioContext ??
    (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
  if (!Ctor) return () => {};
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
    // iOS : le contexte peut naître « suspended » même depuis un geste.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let voicedMs = 0;
    let lastVoice = 0;
    const STEP = 150;
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const d = buf[i] - 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (rms > 6) {
        voicedMs += STEP;
        lastVoice = now;
      } else if (voicedMs >= 600 && lastVoice && now - lastVoice > 1800) {
        onSilence();
      }
    }, STEP);
    return () => {
      clearInterval(timer);
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
      void ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

async function startRecorder(opts: SpeechOpts): Promise<SpeechHandle> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    opts.onError?.(
      name === "NotAllowedError" || name === "SecurityError"
        ? "denied"
        : "error"
    );
    opts.onEnd?.();
    return { stop() {} };
  }

  const mime = pickRecorderMime();
  let rec: MediaRecorder;
  try {
    rec = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    opts.onError?.("unsupported");
    opts.onEnd?.();
    return { stop() {} };
  }

  const chunks: Blob[] = [];
  let finished = false;
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopSilenceWatch = watchSilence(stream, () => {
    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {
      /* ignore */
    }
  });
  rec.onstop = () => {
    stopSilenceWatch();
    stream.getTracks().forEach((t) => t.stop());
    if (finished) return;
    finished = true;
    const blob = new Blob(chunks, {
      type: rec.mimeType || mime || "audio/webm",
    });
    if (blob.size < 400) {
      // Rien d'exploitable (tap trop court).
      opts.onError?.("no-speech");
      opts.onEnd?.();
      return;
    }
    // Signal visuel : la transcription serveur est en cours.
    opts.onPartial?.("…");
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      void transcribeDriveAudio({
        base64,
        mime: blob.type || "audio/webm",
        lang: opts.lang.startsWith("ar") ? "ar" : "fr",
      })
        .then((res) => {
          if (res.ok) opts.onFinal(res.text);
          else opts.onError?.("no-speech");
        })
        .catch(() => opts.onError?.("error"))
        .finally(() => opts.onEnd?.());
    };
    reader.onerror = () => {
      opts.onError?.("error");
      opts.onEnd?.();
    };
    reader.readAsDataURL(blob);
  };

  try {
    rec.start(250);
  } catch {
    stopSilenceWatch();
    stream.getTracks().forEach((t) => t.stop());
    opts.onError?.("error");
    opts.onEnd?.();
    return { stop() {} };
  }

  // Garde-fou : 15 s max de dictée (au-delà, on transcrit ce qu'on a).
  const maxTimer = setTimeout(() => {
    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {
      /* ignore */
    }
  }, 15_000);

  return {
    stop: () => {
      clearTimeout(maxTimer);
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}

async function startNative(opts: SpeechOpts): Promise<SpeechHandle> {
  const p = nativePlugin();
  if (!p) {
    opts.onError?.("unsupported");
    return { stop() {} };
  }
  try {
    const perm = await p.requestPermissions?.();
    if (
      perm &&
      perm.speechRecognition &&
      perm.speechRecognition !== "granted"
    ) {
      opts.onError?.("denied");
      return { stop() {} };
    }
  } catch {
    /* certains devices ne gèrent pas requestPermissions — on tente quand même */
  }

  // ⚠️ Avec partialResults:true, start() se résout TOUT DE SUITE (sans
  // matches) et les erreurs natives suivantes sont perdues (reject sur un
  // call déjà résolu). Vérité = événements : `partialResults` porte AUSSI le
  // résultat final, `listeningState` signale started/stopped. Garde-fous
  // temps pour les erreurs invisibles (ERROR_NO_MATCH après silence…).
  let done = false;
  let last = "";
  const timers: ReturnType<typeof setTimeout>[] = [];
  const sub = await p.addListener("partialResults", (data) => {
    const m = data?.matches?.[0];
    if (m) {
      last = m;
      opts.onPartial?.(m);
    }
  });
  const subState = await (
    p as unknown as {
      addListener: (
        ev: string,
        cb: (d: { status?: string }) => void
      ) => Promise<{ remove: () => void }> | { remove: () => void };
    }
  ).addListener("listeningState", (d) => {
    // Fin d'écoute détectée par Android : petite grâce pour laisser arriver
    // le résultat final (émis juste après « stopped »), puis on conclut.
    if (d?.status === "stopped") timers.push(setTimeout(() => finish(), 900));
  });
  const cleanup = () => {
    timers.forEach(clearTimeout);
    for (const s of [sub, subState]) {
      try {
        (s as { remove?: () => void })?.remove?.();
      } catch {
        /* ignore */
      }
    }
  };
  const finish = () => {
    if (done) return;
    done = true;
    cleanup();
    void p.stop().catch(() => {});
    if (last.trim()) opts.onFinal(last.trim());
    else opts.onError?.("no-speech");
    opts.onEnd?.();
  };

  // Rien entendu du tout en 9 s (erreur avalée ou mutisme) / plafond global.
  timers.push(
    setTimeout(() => {
      if (!last) finish();
    }, 9_000)
  );
  timers.push(setTimeout(finish, 20_000));

  const handle: SpeechHandle = {
    stop: () => {
      void p.stop().catch(() => {});
      // Laisse le résultat final arriver, puis conclut quoi qu'il en soit.
      timers.push(setTimeout(finish, 1_000));
    },
  };

  void p
    .start({
      language: opts.lang,
      partialResults: true,
      popup: false,
      maxResults: 1,
    })
    .then((res) => {
      // Ne se produit qu'en mode non-partiel ou sur certains iOS : si des
      // matches finaux arrivent ici, on les prend.
      const m = res?.matches?.[0];
      if (m) {
        last = m;
        finish();
      }
    })
    .catch(async () => {
      if (done) return;
      done = true;
      cleanup();
      // Service natif indisponible → repli enregistreur + Whisper serveur.
      if (recorderSupported()) {
        const h = await startRecorder(opts);
        handle.stop = h.stop;
        done = false; // le recorder reprend la main sur ce handle
        return;
      }
      opts.onError?.("error");
      opts.onEnd?.();
    });

  return handle;
}

function startWeb(opts: SpeechOpts): SpeechHandle {
  const Ctor = webRecCtor();
  if (!Ctor) {
    opts.onError?.("unsupported");
    return { stop() {} };
  }
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  let fellBack = false;
  const handle: SpeechHandle = {
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
  // Erreurs de SERVICE (reco Google indisponible : navigateurs dérivés,
  // réseaux filtrés…) → on bascule sur l'enregistreur + Whisper serveur au
  // lieu d'afficher « réessaie ». « not-allowed » reste un refus micro.
  const fallbackToRecorder = (kind: string) => {
    if (fellBack) return;
    fellBack = true;
    try {
      rec.onend = null;
      rec.onerror = null;
      rec.stop();
    } catch {
      /* ignore */
    }
    if (recorderSupported()) {
      void startRecorder(opts).then((h) => {
        handle.stop = h.stop;
      });
    } else {
      opts.onError?.(kind);
      opts.onEnd?.();
    }
  };
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    opts.onPartial?.((finalText + interim).trim());
  };
  rec.onerror = (e) => {
    const kind = e?.error || "error";
    if (kind === "not-allowed") {
      opts.onError?.("denied");
      return;
    }
    if (kind === "no-speech" || kind === "aborted") {
      opts.onError?.(kind);
      return;
    }
    // network / service-not-allowed / audio-capture / language-not-supported…
    fallbackToRecorder(kind);
  };
  rec.onend = () => {
    if (fellBack) return;
    if (finalText.trim()) opts.onFinal(finalText.trim());
    opts.onEnd?.();
  };
  try {
    rec.start();
  } catch {
    fallbackToRecorder("error");
  }
  return handle;
}
