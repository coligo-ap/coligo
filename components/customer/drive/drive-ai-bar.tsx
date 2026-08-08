"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  ArrowUp,
  Car,
  Check,
  Loader2,
  MapPin,
  Mic,
  Navigation,
  Sparkles,
  Snowflake,
  Square,
  User,
  X,
} from "lucide-react";
import {
  parseDriveIntent,
  type DriveGamme,
  type DriveIntentDraft,
} from "@/app/(customer)/drive/ai-actions";
import {
  speechSupported,
  startSpeech,
  type SpeechHandle,
  type SpeechLang,
} from "@/lib/native/speech";
import { recordPlacePick } from "@/app/(customer)/actions";
import { ROSE, VIOLET } from "./drive-modals";

const GAMME_LABEL: Record<DriveGamme, string> = {
  classic: "Classic",
  confort: "Confort",
  moto: "Moto",
};

/**
 * Barre « dis où tu veux aller » : le client écrit en langage naturel
 * (darija / arabe / français), le gazetteer résout le lieu, puis on affiche une
 * CARTE DE CONFIRMATION. Rien n'avance vers l'écran prix (et donc rien ne peut
 * partir au réseau des chauffeurs) tant que le client n'a pas confirmé le lieu.
 * Les options (gamme, femme au volant) sont appliquées directement et montrées
 * en badges — le client les ajuste ensuite sur l'écran prix s'il le souhaite.
 */
export function DriveAiBar({
  pickup,
  onResolved,
  onConfirmingChange,
}: {
  pickup: { lat: number; lng: number } | null;
  onResolved: (draft: DriveIntentDraft) => void;
  /** Notifie le parent quand la carte de confirmation est affichée (pour
   *  masquer le reste du trajet et garder l'écran aéré). */
  onConfirmingChange?: (confirming: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<DriveIntentDraft | null>(null);

  // Dictée vocale — native APK ou Web Speech API. La langue est AUTOMATIQUE :
  // elle suit la langue choisie pour l'app (arabe/darija → ar-DZ, français →
  // fr-FR), plus de bouton manuel. Le parseur comprend de toute façon AR + FR +
  // darija quelle que soit la langue dictée.
  const locale = useLocale();
  const lang: SpeechLang = locale === "fr" ? "fr-FR" : "ar-DZ";
  const [listening, setListening] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const speechRef = useRef<SpeechHandle | null>(null);

  useEffect(() => {
    onConfirmingChange?.(!!draft);
  }, [draft, onConfirmingChange]);

  useEffect(() => {
    setMicOk(speechSupported());
    return () => speechRef.current?.stop();
  }, []);

  const toggleMic = async () => {
    if (listening) {
      speechRef.current?.stop();
      return;
    }
    setErr(null);
    setDraft(null);
    setListening(true);
    try {
      speechRef.current = await startSpeech({
        lang,
        onPartial: (txt) => setText(txt),
        // Transcription affichée DANS le champ + analyse automatique : le
        // client voit ce qui a été compris et la carte de confirmation suit.
        onFinal: (txt) => {
          setText(txt);
          void submit(txt);
        },
        onError: (kind) => {
          setListening(false);
          // Ne pas laisser l'indicateur de transcription dans le champ.
          setText((t) => (t === "…" ? "" : t));
          setErr(
            kind === "denied"
              ? "Autorise le micro pour dicter."
              : kind === "unsupported"
                ? "Dictée vocale indisponible sur cet appareil."
                : "Je n'ai pas bien entendu, réessaie."
          );
        },
        onEnd: () => setListening(false),
      });
    } catch {
      setListening(false);
      setErr("Dictée vocale indisponible.");
    }
  };

  const submit = async (raw?: string) => {
    // `raw` : texte fourni directement par la dictée (l'état React n'est pas
    // encore à jour dans le même tick).
    const q = (raw ?? text).trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await parseDriveIntent({ text: q, pickup });
      if (res.ok) setDraft(res.draft);
      else setErr(res.message);
    } catch {
      setErr("Réessaie dans un instant.");
    } finally {
      setBusy(false);
    }
  };

  // Le client confirme explicitement → on pré-remplit l'écran prix.
  const confirm = () => {
    if (!draft) return;
    // Apprentissage : la destination confirmée remonte pour les recherches futures.
    void recordPlacePick({
      lat: draft.destination.lat,
      lng: draft.destination.lng,
      label: draft.destination.text,
    });
    onResolved(draft);
    setDraft(null);
    setText("");
  };

  // Pas le bon lieu ? Le client choisit un autre candidat du gazetteer.
  const pickAlt = (alt: {
    lat: number;
    lng: number;
    display: string;
    kind?: "merchant" | "google";
  }) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            destination: {
              lat: alt.lat,
              lng: alt.lng,
              text: alt.display,
              kind: alt.kind,
            },
            alternatives: [
              {
                lat: d.destination.lat,
                lng: d.destination.lng,
                display: d.destination.text,
                kind: d.destination.kind,
              },
              ...d.alternatives.filter((a) => a.display !== alt.display),
            ].slice(0, 3),
          }
        : d
    );
  };

  /* ─────────── Carte de confirmation du trajet ─────────── */
  if (draft) {
    return (
      <div className="mb-3 rounded-lg border border-[var(--d-line)] bg-[var(--d-surface)] p-3">
        <p
          className="drive-sora text-caption mb-2 flex items-center gap-1.5 font-extrabold tracking-[0.4px] uppercase"
          style={{ color: VIOLET }}
        >
          <Sparkles className="size-3.5" /> Confirme ton trajet
        </p>

        {/* Départ */}
        <div className="flex items-center gap-2.5 rounded-md bg-[var(--d-soft)] px-3 py-2">
          <Navigation className="size-4 shrink-0" style={{ color: VIOLET }} />
          <span className="min-w-0 flex-1">
            <span className="text-micro block font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
              Départ
            </span>
            <span className="text-body-lg block truncate font-bold">
              {draft.pickup.text ?? "Ma position actuelle"}
            </span>
          </span>
        </div>

        {/* Arrivée */}
        <div className="mt-1.5 flex items-center gap-2.5 rounded-md bg-[var(--d-soft)] px-3 py-2">
          <MapPin className="size-4 shrink-0 text-[var(--d-ink)]" />
          <span className="min-w-0 flex-1">
            <span className="text-micro block font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
              Arrivée
            </span>
            <span className="text-body-lg block truncate font-bold">
              {draft.destination.text}
            </span>
          </span>
          {draft.destination.kind === "merchant" && (
            <span
              className="text-nano-lg shrink-0 rounded-full px-1.5 py-0.5 font-extrabold tracking-wide"
              style={{ background: "var(--d-accent)", color: VIOLET }}
            >
              Coligo
            </span>
          )}
        </div>

        {/* Autres lieux possibles (le gazetteer a pu se tromper) */}
        {draft.alternatives.length > 0 && (
          <div className="mt-2">
            <p className="text-caption-lg mb-1 font-semibold text-[var(--d-muted)]">
              Pas le bon lieu ?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {draft.alternatives.map((a) => (
                <button
                  key={a.display}
                  type="button"
                  onClick={() => pickAlt(a)}
                  className="text-label max-w-full truncate rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-2.5 py-1 font-semibold"
                >
                  {a.display}
                  {a.kind === "merchant" && (
                    <span
                      className="ml-1 font-extrabold"
                      style={{ color: VIOLET }}
                    >
                      · Coligo
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Options détectées (appliquées) */}
        {(draft.gamme !== "classic" || draft.female_only) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {draft.gamme !== "classic" && (
              <span
                className="text-caption-lg inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold"
                style={{ background: "var(--d-accent)", color: VIOLET }}
              >
                {draft.gamme === "confort" ? (
                  <Snowflake className="size-3.5" />
                ) : (
                  <Car className="size-3.5" />
                )}
                {GAMME_LABEL[draft.gamme]}
              </span>
            )}
            {draft.female_only && (
              <span
                className="text-caption-lg inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold"
                style={{ background: "rgba(236,72,153,.13)", color: ROSE }}
              >
                <User className="size-3.5" /> Femme au volant
              </span>
            )}
          </div>
        )}

        {/* Actions : rien n'avance sans « Confirmer » */}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="text-body flex items-center justify-center gap-1.5 rounded-md border border-[var(--d-line)] bg-[var(--d-surface)] px-3.5 py-2.5 font-bold text-[var(--d-muted)]"
          >
            <X className="size-4" /> Modifier
          </button>
          <button
            type="button"
            onClick={confirm}
            className="text-body flex flex-1 items-center justify-center gap-1.5 rounded-md px-3.5 py-2.5 font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            <Check className="size-4" /> Confirmer le trajet
          </button>
        </div>
      </div>
    );
  }

  /* ─────────── Barre de saisie ─────────── */
  return (
    <div className="mb-3">
      <div
        className="rounded-card-xl flex items-center gap-1.5 border px-3 py-2 transition-colors"
        style={{
          borderColor: listening ? "#EF4444" : VIOLET,
          // Fond tokenisé (--d-field) : bascule en sombre. Avant, ce violet pâle
          // était figé clair → texte (--d-ink, blanc en sombre) invisible dessus.
          background: listening ? "rgba(229, 72, 77, 0.12)" : "var(--d-field)",
        }}
      >
        <Sparkles
          className="size-4 shrink-0"
          style={{ color: listening ? "#EF4444" : VIOLET }}
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          disabled={busy || listening}
          enterKeyHint="go"
          placeholder={listening ? "Parle…" : "Dis où tu veux aller…"}
          aria-label="Réserver une course"
          className="text-body-lg min-w-0 flex-1 bg-transparent font-semibold text-[var(--d-ink)] outline-none placeholder:font-medium placeholder:text-[var(--d-muted)] disabled:opacity-100"
        />

        {listening ? (
          <button
            type="button"
            onClick={toggleMic}
            aria-label="Arrêter la dictée"
            className="grid size-8 shrink-0 animate-pulse place-items-center rounded-full bg-red-500 text-white"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <>
            {micOk && (
              <button
                type="button"
                onClick={() => void toggleMic()}
                aria-label="Dicter à voix haute"
                className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-surface)]"
                style={{ color: VIOLET }}
              >
                <Mic className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || text.trim().length < 3}
              aria-label="Envoyer"
              className="grid size-8 shrink-0 place-items-center rounded-full text-white transition disabled:opacity-40"
              style={{ background: VIOLET }}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </>
        )}
      </div>
      {err && (
        <p className="text-label-lg mt-1.5 px-1 font-semibold text-red-600">
          {err}
        </p>
      )}
    </div>
  );
}
