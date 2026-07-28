/**
 * Reconnaissance vocale (ar-DZ / fr-FR) — dictée pour l'assistant Drive.
 *
 * CHAÎNE DE REPLI (« ça doit marcher partout ») :
 *  1. APK Capacitor : plugin natif `@capacitor-community/speech-recognition`,
 *     accédé via le pont `window.Capacitor.Plugins.SpeechRecognition` (PAS
 *     d'import du paquet → le bundle web reste propre, cf. pattern Sunmi).
 *  2. Navigateur / PWA : Web Speech API (`webkitSpeechRecognition`).
 *  3. REPLI UNIVERSEL : enregistrement MediaRecorder (getUserMedia) puis
 *     TRANSCRIPTION SERVEUR (Groq Whisper, action transcribeDriveAudio) —
 *     couvre les WebViews sans plugin ni Web Speech (ex. iOS sans pod,
 *     vieux APK) : le micro fonctionne dès que l'appareil sait enregistrer.
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
  if (isNative() && nativePlugin()) return true;
  if (!isNative() && webRecCtor()) return true;
  return recorderSupported();
}

export async function startSpeech(opts: SpeechOpts): Promise<SpeechHandle> {
  // Chaîne de repli : natif → Web Speech → enregistreur + Whisper serveur.
  if (isNative() && nativePlugin()) return startNative(opts);
  if (!isNative() && webRecCtor()) return startWeb(opts);
  if (recorderSupported()) return startRecorder(opts);
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
  rec.onstop = () => {
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

  let done = false;
  let last = "";
  const sub = await p.addListener("partialResults", (data) => {
    const m = data?.matches?.[0];
    if (m) {
      last = m;
      opts.onPartial?.(m);
    }
  });
  const removeSub = () => {
    try {
      (sub as { remove?: () => void })?.remove?.();
    } catch {
      /* ignore */
    }
  };
  const finish = (final: string) => {
    if (done) return;
    done = true;
    removeSub();
    if (final.trim()) opts.onFinal(final.trim());
    opts.onEnd?.();
  };

  const handle: SpeechHandle = {
    stop: () => {
      void p.stop().catch(() => {});
      // finish() sera appelé par la résolution de start() ; filet de sécurité :
      setTimeout(() => finish(last), 600);
    },
  };

  // start() se résout avec les matches finaux quand l'écoute se termine (Android).
  void p
    .start({
      language: opts.lang,
      partialResults: true,
      popup: false,
      maxResults: 1,
    })
    .then((res) => finish(res?.matches?.[0] ?? last))
    .catch(async () => {
      if (done) return;
      done = true;
      removeSub();
      // Le service natif a échoué (indispo sur l'appareil…) → on enchaîne sur
      // le repli enregistreur + Whisper serveur au lieu d'abandonner.
      if (recorderSupported()) {
        const h = await startRecorder(opts);
        handle.stop = h.stop;
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
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    opts.onPartial?.((finalText + interim).trim());
  };
  rec.onerror = (e) => opts.onError?.(e?.error || "error");
  rec.onend = () => {
    if (finalText.trim()) opts.onFinal(finalText.trim());
    opts.onEnd?.();
  };
  try {
    rec.start();
  } catch {
    opts.onError?.("error");
  }
  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
