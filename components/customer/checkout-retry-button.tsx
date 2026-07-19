"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { retryOnlineOrderPayment } from "@/app/(customer)/checkout/actions";
import { openCheckout } from "@/lib/payments/open-checkout";
import {
  IntlPaymentSheet,
  type StripeIntentPayload,
} from "@/components/customer/intl-payment-sheet";

// =============================================================================
// CheckoutRetryButton — relance le paiement d'une commande créée mais non
// payée, sur son rail d'ORIGINE (tranché serveur) :
//   - Chargily (DA)  → redirection vers la page de paiement hébergée ;
//   - Stripe (€)     → feuille de paiement EMBARQUÉE (carte + Apple Pay +
//     Google Pay), comme au checkout — aucune redirection.
// =============================================================================
export function CheckoutRetryButton({ orderId }: { orderId: string }) {
  const t = useTranslations("checkout");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useActionNote();
  const [intlIntent, setIntlIntent] = useState<StripeIntentPayload | null>(
    null
  );
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        onClick={() =>
          start(async () => {
            setNote(null);
            const res = await retryOnlineOrderPayment(orderId);
            if (!res.ok) {
              setNote({ ok: false, text: res.error });
              return;
            }
            if (res.stripe_intent) {
              setIntlIntent(res.stripe_intent);
              return;
            }
            if (res.checkout_url) {
              // Navigateur intégré en APK (on reste sur le suivi de commande,
              // qui se réactualise au retour), redirection sur le web.
              await openCheckout(res.checkout_url);
            }
          })
        }
        disabled={pending}
        className="w-full"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <RefreshCcw className="size-4" />
            {t("retryPayment")}
          </>
        )}
      </Button>
      <ActionNote note={note} className="text-center" />

      {intlIntent && (
        <IntlPaymentSheet
          intent={intlIntent}
          onSuccess={() => {
            setIntlIntent(null);
            router.push(`/checkout/success?order_id=${orderId}`);
          }}
          onClose={() => setIntlIntent(null)}
        />
      )}
    </div>
  );
}
