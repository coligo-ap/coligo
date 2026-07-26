"use client";

import { PhoneCall } from "lucide-react";
import { useOrderCall } from "@/lib/call/use-inapp-call";

/**
 * « Appeler via l'app » (détail commande commerçant) — appel in-app
 * commerçant → CLIENT, numéros par-dessus l'app (Agora), sonnerie plein écran
 * chez le client même app fermée (push FCM APPEL). Sens unique : le client ne
 * peut pas rappeler par ce canal.
 *
 * Complète le bouton tel: (appel téléphonique classique) sans le remplacer.
 */
export function OrderCallButton({
  orderId,
  customerName,
}: {
  orderId: string;
  customerName: string;
}) {
  const call = useOrderCall({
    orderId,
    role: "merchant",
    peerName: customerName,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => call.start(false)}
        disabled={call.busy}
        className="border-primary-200 text-primary-700 hover:bg-primary-50 inline-flex shrink-0 items-center gap-1.5 rounded-full border-[1.5px] bg-white px-3.5 py-2 text-sm font-bold transition-colors disabled:opacity-60"
      >
        <PhoneCall className="size-4" />
        Via l&apos;app
      </button>
      {call.ui}
    </>
  );
}
