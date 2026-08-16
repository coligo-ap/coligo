"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  Gift,
  Loader2,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDA } from "@/lib/utils";
import { loyaltyBuzz, LoyaltyRedeemBlock } from "./loyalty-panel";
import {
  creditLoyaltyOrder,
  getLoyaltyOrderContext,
  redeemLoyaltyOrder,
  type LoyaltyCreditData,
  type LoyaltyOrderContext,
  type LoyaltyRedeemResult,
} from "@/app/(merchant)/orders/loyalty-actions";

/**
 * Cas combiné commande + fidélité (SPEC 2.4), affiché SOUS le panneau de
 * succès du retrait — sans toucher au flux retrait lui-même :
 *   • « Créditer la fidélité sur cette commande » EN UN TAP (montant repris
 *     côté serveur, une seule fois par commande) ;
 *   • réduction disponible proposée à l'encaissement (commandes non payées
 *     en ligne uniquement — en ligne, l'argent est déjà encaissé).
 * Si le client n'a pas de compte ou que rien ne s'applique : rien ne
 * s'affiche, l'écran reste identique à avant.
 */
export function OrderLoyaltyOffer({ orderId }: { orderId: string }) {
  const [ctx, setCtx] = useState<LoyaltyOrderContext | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credited, setCredited] = useState<LoyaltyCreditData | null>(null);
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemed, setRedeemed] = useState<LoyaltyRedeemResult | null>(null);
  // Op id stable : un retry manuel après échec réseau rejoue la MÊME
  // opération (idempotent côté serveur).
  const opRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    let alive = true;
    void getLoyaltyOrderContext(orderId).then((c) => {
      if (alive) setCtx(c);
    });
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (!ctx?.ok || !ctx.customer) return null;

  const summary = ctx.summary ?? {
    balance_da: 0,
    available_da: 0,
    vouchers: [],
    progress: null,
  };
  const canRedeem =
    ctx.payment_method !== "online" &&
    (summary.vouchers.length > 0 || summary.available_da > 0);
  const canCredit = ctx.can_credit === true && !credited;

  if (!canCredit && !canRedeem && !ctx.already_credited) return null;

  async function credit() {
    setError(null);
    setPending(true);
    try {
      const res = await creditLoyaltyOrder(orderId, opRef.current);
      if (res.error || !res.data) {
        setError(res.error ?? "Crédit impossible.");
        loyaltyBuzz("error");
        return;
      }
      setCredited(res.data);
      loyaltyBuzz("success");
    } catch {
      setError("Échec réseau — le crédit n'est pas confirmé. Réessayez.");
      loyaltyBuzz("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-primary-200 bg-surface mt-3 rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="bg-primary-50 text-primary-700 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold tracking-wide uppercase">
          <CreditCard className="size-3.5" />
          Fidélité
        </span>
        {ctx.label && (
          <span className="text-foreground truncate text-sm font-bold">
            {ctx.label}
          </span>
        )}
      </div>

      {credited ? (
        <div className="space-y-2 text-center">
          <p className="text-success-700 flex items-center justify-center gap-2 text-lg font-bold">
            <CheckCircle2 className="size-5" />+{formatDA(credited.earned_da)}{" "}
            crédités
          </p>
          {(credited.vouchers_granted ?? []).map((v) => (
            <p
              key={v.id}
              className="text-success-800 flex items-center justify-center gap-1.5 text-sm font-semibold"
            >
              <Sparkles className="size-4" />
              Bon de {formatDA(v.amount_da)} débloqué !
            </p>
          ))}
          {(credited.voucher_deferred_da ?? 0) > 0 && (
            <p className="text-warning-800 bg-warning-50 flex items-center justify-center gap-1.5 rounded-md p-2 text-sm font-semibold">
              <Gift className="size-4" />
              Bon de {formatDA(credited.voucher_deferred_da)} gagné — actif
              demain
            </p>
          )}
        </div>
      ) : ctx.already_credited ? (
        <p className="text-muted flex items-center gap-1.5 text-sm font-medium">
          <CheckCircle2 className="text-success-600 size-4" />
          Fidélité déjà créditée sur cette commande.
        </p>
      ) : canCredit ? (
        <>
          <Button
            size="lg"
            className="h-12 w-full"
            disabled={pending}
            onClick={() => void credit()}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Créditer la fidélité ({formatDA(ctx.credit_amount_da ?? 0)}{" "}
            d&apos;achats)
          </Button>
          {error && (
            <p className="text-danger-600 mt-2 text-center text-sm font-medium">
              {error}
            </p>
          )}
        </>
      ) : null}

      {canRedeem && !redeemed && (
        <div className="mt-3">
          {showRedeem ? (
            <LoyaltyRedeemBlock
              summary={
                credited?.summary && ctx.payment_method !== "online"
                  ? credited.summary
                  : summary
              }
              execute={(op, voucherId, amountDa) =>
                redeemLoyaltyOrder(orderId, op, voucherId, amountDa)
              }
              onDone={setRedeemed}
            />
          ) : (
            <Button
              variant="outline"
              size="lg"
              className="h-12 w-full"
              onClick={() => setShowRedeem(true)}
            >
              <Minus className="size-4" />
              Appliquer une réduction (
              {formatDA(
                summary.available_da +
                  summary.vouchers.reduce((s, v) => s + v.amount_da, 0)
              )}{" "}
              dispo)
            </Button>
          )}
        </div>
      )}

      {redeemed && (
        <p className="text-success-700 mt-3 flex items-center justify-center gap-2 text-lg font-bold">
          <CheckCircle2 className="size-5" />−
          {formatDA(redeemed.deducted_da ?? 0)} à déduire de l&apos;addition
        </p>
      )}
    </div>
  );
}
