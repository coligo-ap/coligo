"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, ShieldX, Trash2 } from "lucide-react";
import { deleteMyCustomerAccount } from "@/app/(customer)/compte/actions";
import { formatDA } from "@/lib/utils";

/**
 * Écran « Supprimer mon compte » (exigence Google Play : suppression de compte
 * accessible in-app ET via URL web — cette page sert les deux).
 *
 * Messages INLINE (règle produit : pas de toast) ; l'action serveur re-vérifie
 * toutes les gardes (commande/course active, compte pro) — les props ne servent
 * qu'à un affichage honnête AVANT le clic.
 */
export function DeleteAccountScreen({
  blocked,
  cashbackDa,
  topupDa,
}: {
  /** Commande ou course encore active → suppression refusée d'avance. */
  blocked: boolean;
  cashbackDa: number;
  topupDa: number;
}) {
  const t = useTranslations("account");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const balance = (cashbackDa ?? 0) + (topupDa ?? 0);

  const onDelete = async () => {
    setSubmitting(true);
    setError(null);
    const res = await deleteMyCustomerAccount();
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setDone(true);
    // Session déjà close côté serveur — retour à l'accueil en rechargement
    // COMPLET (purge tout état client : caches, stores, realtime).
    setTimeout(() => window.location.replace("/"), 1800);
  };

  if (done) {
    return (
      <div className="px-5 pt-16 text-center">
        <span className="bg-surface-2 text-muted mx-auto grid size-14 place-items-center rounded-full">
          <Trash2 className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-black tracking-tight">
          {t("delDoneTitle")}
        </h2>
        <p className="text-muted mt-1.5 text-sm">{t("delDoneBody")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-5">
      {/* Ce qui va se passer — encart d'avertissement. */}
      <section className="border-danger-200 bg-danger-50 rounded-[16px] border p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-danger-700 mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-danger-800 text-sm font-extrabold">
              {t("delIrreversible")}
            </p>
            <ul className="text-danger-700 mt-2 list-disc space-y-1.5 ps-4 text-[13px] leading-snug">
              <li>{t("delBulletProfile")}</li>
              <li>{t("delBulletHistory")}</li>
              <li>{t("delBulletBalance")}</li>
              <li>{t("delBulletLogin")}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Solde restant — affiché seulement s'il y a de l'argent à perdre. */}
      {balance > 0 && (
        <section className="border-border rounded-[16px] border bg-white p-4">
          <p className="text-sm font-bold">
            {t("delBalanceWarn", { amount: formatDA(balance) })}
          </p>
          <p className="text-muted mt-1 text-xs">{t("delBalanceHint")}</p>
        </section>
      )}

      {blocked ? (
        /* Commande / course en vol : pas de suppression possible maintenant. */
        <section className="border-border rounded-[16px] border bg-white p-4">
          <div className="flex items-start gap-3">
            <ShieldX className="text-muted mt-0.5 size-5 shrink-0" />
            <p className="text-sm font-semibold">{t("delBlockedActive")}</p>
          </div>
        </section>
      ) : (
        <section className="border-border space-y-4 rounded-[16px] border bg-white p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="accent-danger-600 mt-0.5 size-4 shrink-0"
            />
            <span className="text-[13px] leading-snug font-medium">
              {t("delConfirmLabel")}
            </span>
          </label>

          {/* Erreur INLINE au-dessus du bouton (jamais de toast). */}
          {error && (
            <p className="text-danger-700 bg-danger-50 rounded-[10px] px-3 py-2 text-[13px] font-semibold">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={onDelete}
            disabled={!confirmed || submitting}
            className="bg-danger-600 hover:bg-danger-700 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] text-sm font-bold text-white transition-colors disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {submitting ? t("delDeleting") : t("delCta")}
          </button>
        </section>
      )}
    </div>
  );
}
