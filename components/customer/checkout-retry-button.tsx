"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { retryOnlineOrderPayment } from "@/app/(customer)/checkout/actions";

// =============================================================================
// CheckoutRetryButton — relance un checkout Chargily pour une commande
// déjà créée mais non payée. La Server Action recrée un checkout Chargily
// (idempotent côté DB : la commande reste la même, seul un nouveau checkout
// Chargily est créé). On `window.location` vers l'URL retournée.
// =============================================================================
export function CheckoutRetryButton({ orderId }: { orderId: string }) {
  const t = useTranslations("checkout");
  const [pending, start] = useTransition();
  const [note, setNote] = useActionNote();
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
            window.location.href = res.checkout_url;
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
    </div>
  );
}
