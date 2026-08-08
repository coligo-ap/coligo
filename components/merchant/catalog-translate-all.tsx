"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { completeCatalogTranslationsAction } from "@/app/(merchant)/actions/translate";

/**
 * Bouton « Compléter l'arabe » du catalogue : remplit en un clic tous les
 * `name_ar` / `description_ar` VIDES des produits actifs (jamais d'écrasement
 * d'une traduction existante). Résultat affiché inline (pas de toast).
 */
export function CatalogTranslateAll({
  onDone,
  className,
}: {
  onDone?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await completeCatalogTranslationsAction();
      if (res.error) {
        setMsg({ kind: "err", text: res.error });
        return;
      }
      const updated = res.updated ?? 0;
      const remaining = res.remaining ?? 0;
      if (updated === 0 && remaining === 0) {
        setMsg({
          kind: "ok",
          text: "Toutes les fiches ont déjà leur traduction arabe.",
        });
      } else {
        setMsg({
          kind: "ok",
          text: `${updated} champ${updated > 1 ? "s" : ""} traduit${updated > 1 ? "s" : ""}${remaining > 0 ? ` — ${remaining} restant(s), relancez le bouton` : ""}.`,
        });
      }
      if (updated > 0) onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col items-stretch gap-1", className)}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="Traduction automatique par IA de tous les champs vides du catalogue"
        className={cn(
          buttonVariants({ variant: "outline" }),
          "flex-1 justify-center sm:flex-initial"
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        <span className="sm:hidden">{busy ? "Traduction…" : "Arabe"}</span>
        <span className="hidden sm:inline">
          {busy ? "Traduction en cours…" : "Compléter l'arabe"}
        </span>
        {/* Pastille IA : assume la traduction par intelligence artificielle. */}
        {!busy && (
          <span className="bg-primary-600 text-nano rounded-full px-1.5 py-px leading-4 font-extrabold text-white">
            IA
          </span>
        )}
      </button>
      {msg && (
        <p
          className={cn(
            "text-xs",
            msg.kind === "err" ? "text-danger-600" : "text-emerald-600"
          )}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
