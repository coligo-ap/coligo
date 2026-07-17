"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, PhoneOff, ShieldAlert, XCircle } from "lucide-react";
import { acknowledgeFraudCancelWarning } from "@/app/(customer)/fraud-actions";

/**
 * Popup anti-fraude OBLIGATOIRE (mig 0373-0374, docs/ANTI-FRAUDE.md §7).
 *
 * Montée par le layout client quand `customer_fraud_gate()` renvoie
 * `require_ack` (≥ N situations suspectes : annulations après contact du
 * partenaire / près de la destination). IMPOSSIBLE à fermer ou contourner :
 * pas de croix, pas de clic-dehors, pas d'Échap — l'overlay couvre tout
 * l'espace client, et le serveur REFUSE toute nouvelle commande/course tant
 * que l'avertissement n'est pas accepté (défense en profondeur).
 *
 * Le clic sur « Oui, j'ai compris et je suis d'accord » enregistre la preuve
 * (customer_fraud_acks : IP, appareil, horodatage) puis libère l'écran.
 */
export function FraudAckGate() {
  const t = useTranslations("fraudAck");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return null;

  const accept = () => {
    if (pending) return;
    setError(false);
    startTransition(async () => {
      const res = await acknowledgeFraudCancelWarning();
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(true);
      }
    });
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[400] flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center"
    >
      <div className="bg-surface w-full max-w-md rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-3xl sm:pb-5">
        <div className="bg-danger-500/10 mx-auto grid size-14 place-items-center rounded-2xl">
          <ShieldAlert className="text-danger-500 size-8" />
        </div>
        <h2 className="text-foreground mt-3 text-center text-lg font-extrabold tracking-tight">
          {t("title")}
        </h2>
        <p className="text-muted mt-1.5 text-center text-sm leading-relaxed">
          {t("intro")}
        </p>

        <div className="mt-4 space-y-2.5">
          <div className="bg-surface-2 flex items-start gap-2.5 rounded-xl p-3">
            <XCircle className="text-danger-500 mt-0.5 size-4.5 shrink-0" />
            <p className="text-foreground text-sm leading-snug">{t("rule1")}</p>
          </div>
          <div className="bg-surface-2 flex items-start gap-2.5 rounded-xl p-3">
            <PhoneOff className="text-danger-500 mt-0.5 size-4.5 shrink-0" />
            <p className="text-foreground text-sm leading-snug">{t("rule2")}</p>
          </div>
        </div>

        <p className="text-muted mt-3 text-center text-xs leading-relaxed">
          {t("support")}
        </p>

        {error && (
          <p className="text-danger-500 mt-2 text-center text-sm font-medium">
            {t("error")}
          </p>
        )}

        <button
          type="button"
          onClick={accept}
          disabled={pending}
          className="bg-accent mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold text-white transition active:scale-[0.99] disabled:opacity-70"
        >
          {pending ? <Loader2 className="size-5 animate-spin" /> : t("confirm")}
        </button>
      </div>
    </div>
  );
}
