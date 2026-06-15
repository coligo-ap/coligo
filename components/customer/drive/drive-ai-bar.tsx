"use client";

import { useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import {
  parseDriveIntent,
  type DriveIntentDraft,
} from "@/app/(customer)/drive/ai-actions";
import { VIOLET } from "./drive-modals";

/**
 * Barre « dis où tu veux aller » : le client écrit en langage naturel
 * (darija / arabe / français), l'IA en extrait le trajet, et on pré-remplit
 * l'écran prix existant. L'IA ne crée aucune course — juste un brouillon que
 * le client confirme ensuite normalement.
 */
export function DriveAiBar({
  pickup,
  onResolved,
}: {
  pickup: { lat: number; lng: number } | null;
  onResolved: (draft: DriveIntentDraft) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await parseDriveIntent({ text: q, pickup });
      if (res.ok) {
        setText("");
        onResolved(res.draft);
      } else {
        setErr(res.message);
      }
    } catch {
      setErr("Réessaie dans un instant.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3">
      <div
        className="flex items-center gap-2 rounded-[15px] border px-3 py-2"
        style={{ borderColor: VIOLET, background: "#F6F3FE" }}
      >
        <Sparkles className="size-4 shrink-0" style={{ color: VIOLET }} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          disabled={busy}
          enterKeyHint="go"
          placeholder="Dis où tu veux aller…"
          aria-label="Réserver une course en parlant"
          className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-[var(--d-ink)] outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
        />
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
      </div>
      {err && (
        <p className="mt-1.5 px-1 text-[12.5px] font-semibold text-red-600">
          {err}
        </p>
      )}
    </div>
  );
}
