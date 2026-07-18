"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Loader2, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";

// =============================================================================
// IntlPaymentSheet — paiement € EMBARQUÉ (Payment Element), style Bolt :
// feuille ancrée en bas, poignée, montant en gros, carte + Apple Pay +
// Google Pay dans la page (aucune redirection). Le client_secret vient du
// serveur (créé au taux maison — jamais le taux ici) ; la confirmation
// finale reste le webhook payment_intent.succeeded : au succès local on
// route vers la commande, qui basculera « payée » via le poll/Realtime.
//
// Sécurité UI : fermer la feuille pendant un paiement en vol est bloqué
// (le client ne doit pas croire qu'il a annulé alors que la banque débite).
// =============================================================================

export type StripeIntentPayload = {
  client_secret: string;
  publishable_key: string;
  eur_cents: number;
};

function eurLabel(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function IntlPaymentSheet({
  intent,
  onSuccess,
  onClose,
}: {
  intent: StripeIntentPayload;
  /** Paiement confirmé côté Stripe → le parent vide le panier et route. */
  onSuccess: () => void;
  /** Fermeture volontaire AVANT paiement (la commande reste réglable). */
  onClose: () => void;
}) {
  const t = useTranslations("checkout");
  const locale = useLocale();
  // Une seule promesse loadStripe par montage (exigence stripe-js), clé du
  // MODE actif renvoyée par le serveur.
  const stripePromise = useMemo(
    () => loadStripe(intent.publishable_key),
    [intent.publishable_key]
  );
  // Thème : le sombre client est la classe `theme-dark` posée sur <html>
  // (jamais prefers-color-scheme — cf. règles dark mode client).
  const dark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-dark");
  const [paying, setPaying] = useState(false);

  return (
    <Portal>
      <div className="fixed inset-0 z-[130] flex flex-col justify-end">
        {/* Voile — fermeture bloquée pendant un paiement en vol. */}
        <button
          type="button"
          aria-label={t("intlSheetClose")}
          onClick={() => {
            if (!paying) onClose();
          }}
          className="absolute inset-0 bg-black/55"
        />
        <div className="bg-surface relative animate-[intlSheetUp_.32s_cubic-bezier(.16,1,.3,1)] rounded-t-[24px] shadow-[0_-8px_30px_rgba(0,0,0,.35)]">
          <style>{`@keyframes intlSheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
          <span className="bg-border mx-auto mt-2 block h-1 w-10 rounded-full" />

          <div className="flex items-start justify-between gap-3 px-5 pt-3">
            <div>
              <p className="text-foreground text-[17px] font-extrabold">
                {t("intlSheetTitle")}
              </p>
              <p className="text-muted mt-0.5 text-[12px] font-semibold">
                {t("intlSheetSub")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!paying) onClose();
              }}
              disabled={paying}
              aria-label={t("intlSheetClose")}
              className="bg-surface-2 text-foreground grid size-9 shrink-0 place-items-center rounded-full disabled:opacity-40"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="max-h-[62dvh] overflow-y-auto px-5 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret: intent.client_secret,
                locale: locale === "ar" ? "ar" : locale === "en" ? "en" : "fr",
                appearance: {
                  theme: dark ? "night" : "stripe",
                  variables: {
                    colorPrimary: "#6C2BD9",
                    colorDanger: "#e11d48",
                    borderRadius: "14px",
                    fontFamily:
                      "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
                    fontSizeBase: "14px",
                    spacingUnit: "4px",
                  },
                  rules: {
                    ".Input": { boxShadow: "none", borderWidth: "1.5px" },
                    ".Input:focus": {
                      borderColor: "#6C2BD9",
                      boxShadow: "0 0 0 3px rgba(108,43,217,.15)",
                    },
                    ".Tab": { borderRadius: "12px" },
                    ".Label": { fontWeight: "700", fontSize: "12px" },
                  },
                },
              }}
            >
              <PayForm
                eurCents={intent.eur_cents}
                paying={paying}
                setPaying={setPaying}
                onSuccess={onSuccess}
              />
            </Elements>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Formulaire interne (doit vivre SOUS <Elements> pour les hooks Stripe). */
function PayForm({
  eurCents,
  paying,
  setPaying,
  onSuccess,
}: {
  eurCents: number;
  paying: boolean;
  setPaying: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("checkout");
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  // Apple Pay / Google Pay détectés sur CET appareil ? (Safari/iPhone →
  // Apple Pay, Chrome/Android → Google Pay ; rien = boutons masqués).
  const [hasWallets, setHasWallets] = useState(false);

  /** Confirmation partagée : bouton carte ET boutons express (wallets). */
  async function confirmNow() {
    if (!stripe || !elements || succeeded) return;
    setError(null);
    setPaying(true);
    try {
      // allow_redirects: "never" côté serveur → pas de return_url ; le 3DS
      // s'ouvre en modale par-dessus la feuille, sans quitter l'app.
      const res = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });
      if (res.error) {
        setError(res.error.message ?? t("intlPayError"));
        return;
      }
      const status = res.paymentIntent?.status;
      if (status === "succeeded" || status === "processing") {
        setSucceeded(true);
        onSuccess();
        return;
      }
      setError(t("intlPayError"));
    } finally {
      setPaying(false);
    }
  }

  async function pay() {
    if (paying) return;
    await confirmNow();
  }

  return (
    <>
      {!ready && (
        <div className="grid place-items-center py-10">
          <Loader2 className="text-primary-600 size-6 animate-spin" />
        </div>
      )}
      <div className={cn(!ready && "hidden")}>
        {/* Boutons EXPRESS (Apple Pay / Google Pay) — rendus par Stripe
            uniquement si l'appareil les supporte ; le formulaire carte reste
            en dessous. Link coupé (bruit inutile pour la diaspora). */}
        <div className={cn(!hasWallets && "hidden")}>
          <ExpressCheckoutElement
            options={{
              buttonHeight: 48,
              buttonTheme: { applePay: "black", googlePay: "black" },
              paymentMethods: {
                applePay: "auto",
                googlePay: "auto",
                link: "never",
              },
            }}
            onReady={(e) => setHasWallets(!!e.availablePaymentMethods)}
            onConfirm={() => void confirmNow()}
          />
          <div className="my-4 flex items-center gap-3">
            <span className="bg-border h-px flex-1" />
            <span className="text-subtle text-[11px] font-extrabold tracking-wide uppercase">
              {t("intlOrCard")}
            </span>
            <span className="bg-border h-px flex-1" />
          </div>
        </div>

        <PaymentElement
          onReady={() => setReady(true)}
          options={{
            layout: { type: "tabs", defaultCollapsed: false },
            // Les wallets vivent DANS les boutons express ci-dessus — on les
            // retire du formulaire carte pour éviter le doublon.
            wallets: { applePay: "never", googlePay: "never" },
          }}
        />

        {error && (
          <p className="border-danger-200 bg-danger-50 text-danger-800 mt-3 rounded-[12px] border px-3.5 py-2.5 text-[12.5px] font-bold">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void pay()}
          disabled={!stripe || paying || succeeded}
          className={cn(
            "mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-extrabold text-white transition active:scale-[0.99]",
            succeeded
              ? "bg-success-600"
              : "bg-primary-600 hover:bg-primary-700 disabled:opacity-60"
          )}
        >
          {paying ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <>
              <Lock className="size-4" />
              {t("intlPayButton", { amount: eurLabel(eurCents) })}
            </>
          )}
        </button>

        <p className="text-subtle mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11px] font-semibold">
          <Lock className="size-3" />
          {t("intlSecureNote")}
        </p>
      </div>
    </>
  );
}
