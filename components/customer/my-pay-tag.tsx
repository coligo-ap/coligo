"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Share2, Wallet } from "lucide-react";
import { toast } from "@/components/ui/toast";

// =============================================================================
// MyPayTag — affiche l'identifiant Coligo Pay (tag/@handle) du client sur la
// page /coligo-pay, avec « Copier » + « Partager » pour l'envoyer à un ami qui
// pourra alors lui faire un transfert. Le handle est un identifiant public
// stable (pas un secret) ; il sert à recevoir des paiements/transferts.
// =============================================================================
export function MyPayTag({ handle, name }: { handle: string; name: string }) {
  const t = useTranslations("wallet");
  const [copied, setCopied] = useState(false);
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(handle);
      setCopied(true);
      toast.success(t("copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  async function share() {
    const text = t("shareTagText", { name, handle });
    try {
      await navigator.share({ title: "Coligo Pay", text });
    } catch {
      // L'utilisateur a annulé le partage, ou API indispo → on copie en repli.
      void copy();
    }
  }

  return (
    <div className="mt-4 rounded-[18px] bg-white p-4 shadow-[0_8px_20px_-16px_rgba(40,35,90,.2)]">
      <div className="flex items-center gap-2">
        <span className="bg-primary-50 text-primary-600 grid size-9 shrink-0 place-items-center rounded-[11px]">
          <Wallet className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
            {t("myTagTitle")}
          </p>
          <p className="text-foreground text-lg leading-tight font-black tracking-wider tabular-nums">
            @{handle}
          </p>
        </div>
      </div>

      <p className="text-muted mt-2.5 text-[12px] font-medium">
        {t("myTagHint")}
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[13px] text-sm font-extrabold text-white transition-colors"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("copied") : t("copy")}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={share}
            className="border-border text-foreground hover:bg-surface-2 inline-flex h-11 items-center justify-center gap-2 rounded-[13px] border px-4 text-sm font-extrabold transition-colors"
          >
            <Share2 className="size-4" />
            {t("share")}
          </button>
        )}
      </div>
    </div>
  );
}
