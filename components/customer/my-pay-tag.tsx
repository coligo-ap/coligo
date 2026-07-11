"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Share2 } from "lucide-react";

// =============================================================================
// MyPayTag — puce « identifiant Coligo Pay » (tag/@handle) INTÉGRÉE dans le hero
// (style glass sur fond violet). Copier / Partager pour l'envoyer à un ami qui
// pourra faire un transfert. Identifiant public stable (pas un secret).
// =============================================================================
export function MyPayTag({ handle, name }: { handle: string; name: string }) {
  const t = useTranslations("wallet");
  const [copied, setCopied] = useState(false);
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(`@${handle}`);
      // Le bouton passe à « Copié ✓ » — c'est le retour visuel (pas de toast).
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papiers indisponible — le bouton ne change pas (silencieux) */
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "Coligo Pay",
        text: t("shareTagText", { name, handle }),
      });
    } catch {
      void copy();
    }
  }

  return (
    <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/15 bg-white/15 py-2 ps-3.5 pe-2 backdrop-blur">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold tracking-wide text-white/70 uppercase">
          {t("myTagTitle")}
        </p>
        <p className="truncate text-[15px] font-black tracking-wider tabular-nums">
          @{handle}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/20 px-3 text-[12.5px] font-extrabold transition-colors hover:bg-white/30 active:scale-95"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t("copied") : t("copy")}
      </button>
      {canShare && (
        <button
          type="button"
          onClick={share}
          aria-label={t("share")}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20 transition-colors hover:bg-white/30 active:scale-95"
        >
          <Share2 className="size-4" />
        </button>
      )}
    </div>
  );
}
