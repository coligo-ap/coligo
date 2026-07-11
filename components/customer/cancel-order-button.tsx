"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, ShieldAlert, Wallet, X } from "lucide-react";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { formatDA } from "@/lib/utils";
import { cancelMyOrder } from "@/app/(customer)/commandes/actions";

type Props = {
  orderId: string;
  paymentMethod: "cash" | "online";
  paymentStatus: string | null;
  /** Anti-fraude : trop d'annulations-remboursées récentes → online non
   *  annulable (le client doit récupérer la commande). */
  refundBlocked?: boolean;
};

/**
 * Bouton « Annuler ma commande » — visible UNIQUEMENT tant que la commande est
 * en attente (status='pending', géré par le parent). Pour une commande payée en
 * ligne, le montant payé est REMBOURSÉ EN CRÉDIT COLIGO PAY (avoir in-app) : on
 * en informe clairement le client. La vérification réelle (propriété, statut,
 * calcul du remboursement) est faite côté serveur (RPC) — ici c'est l'UI.
 */
export function CancelOrderButton({
  orderId,
  paymentMethod,
  paymentStatus,
  refundBlocked = false,
}: Props) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [note, setNote] = useActionNote();
  const [pending, startTransition] = useTransition();

  const onlinePaid = paymentMethod === "online" && paymentStatus === "paid";

  // Anti-fraude : commande payée en ligne non annulable (plafond de
  // remboursements atteint). On informe directement, pas de bouton.
  if (onlinePaid && refundBlocked) {
    return (
      <p className="text-muted bg-surface-2 mt-2.5 flex items-start gap-1.5 rounded-[10px] p-2.5 text-[11.5px] font-medium">
        <ShieldAlert className="text-warning-600 mt-0.5 size-4 shrink-0" />
        {t("refundBlockedNotice")}
      </p>
    );
  }

  function doCancel() {
    startTransition(async () => {
      const res = await cancelMyOrder(orderId);
      if (!res.ok) {
        // Erreur EN LIGNE : le panneau reste ouvert, le client peut réessayer.
        setNote({ ok: false, text: res.error });
        return;
      }
      // Confirmation EN LIGNE. La carte disparaît au refresh (la commande n'est
      // plus « en attente ») : on laisse le client lire le remboursement avant.
      setDone(true);
      setNote({
        ok: true,
        text:
          res.refundedToColigoPay > 0
            ? t("cancelledWithRefund", {
                amount: formatDA(res.refundedToColigoPay),
              })
            : t("cancelled"),
      });
      setTimeout(() => router.refresh(), 1600);
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="border-danger-200 text-danger-700 hover:bg-danger-50 mt-2.5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[12px] border text-[13px] font-bold"
      >
        <X className="size-4" />
        {t("cancelMyOrder")}
      </button>
    );
  }

  return (
    <div className="border-danger-200 bg-danger-50 mt-2.5 rounded-[12px] border p-3">
      <p className="text-danger-800 text-[12.5px] font-semibold">
        {t("cancelConfirm")}
      </p>
      {onlinePaid && (
        <p className="text-primary-800 bg-primary-50 mt-2 flex items-start gap-1.5 rounded-[10px] p-2.5 text-[12px] font-semibold">
          <Wallet className="text-primary-600 mt-0.5 size-4 shrink-0" />
          {t("cancelRefundIntro")} <strong>{t("cancelRefundStrong")}</strong>{" "}
          {t("cancelRefundOutro")}
        </p>
      )}
      <ActionNote note={note} className="mt-2" />
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending || done}
          className="border-border text-foreground hover:bg-surface-2 inline-flex h-10 flex-1 items-center justify-center rounded-[10px] border bg-white text-[13px] font-bold disabled:opacity-50"
        >
          {t("back")}
        </button>
        <button
          type="button"
          onClick={doCancel}
          disabled={pending || done}
          className="bg-danger-600 hover:bg-danger-700 inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-bold text-white disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            t("yesCancel")
          )}
        </button>
      </div>
    </div>
  );
}
