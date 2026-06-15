/**
 * Reconnaissance vocale (ar-DZ / fr-FR) — dictée pour l'assistant Drive.
 *
 * - APK Capacitor : plugin natif `@capacitor-community/speech-recognition`,
 *   accédé via le pont `window.Capacitor.Plugins.SpeechRecognition` (PAS
 *   d'import du paquet → le bundle web reste propre, cf. pattern SunmiPrinter).
 *   Le WebView Android ne supporte pas l'API Web Speech : le natif est requis.
 * - Navigateur / PWA : Web Speech API (`webkitSpeechRecognition`).
 *
 * Tout est best-effort + dégradation gracieuse : si rien n'est dispo,
 * `speechSupported()` renvoie false et l'UI masque le micro.
 */

import { isNative } from "./context";

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

export function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  return isNative() ? !!nativePlugin() : !!webRecCtor();
}

export async function startSpeech(opts: SpeechOpts): Promise<SpeechHandle> {
  return isNative() ? startNative(opts) : startWeb(opts);
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

  // start() se résout avec les matches finaux quand l'écoute se termine (Android).
  void p
    .start({
      language: opts.lang,
      partialResults: true,
      popup: false,
      maxResults: 1,
    })
    .then((res) => finish(res?.matches?.[0] ?? last))
    .catch(() => {
      if (!done) {
        done = true;
        removeSub();
        opts.onError?.("error");
        opts.onEnd?.();
      }
    });

  return {
    stop: () => {
      void p.stop().catch(() => {});
      // finish() sera appelé par la résolution de start() ; filet de sécurité :
      setTimeout(() => finish(last), 600);
    },
  };
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
