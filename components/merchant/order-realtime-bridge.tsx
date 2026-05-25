"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PartyPopper, Volume2, X } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { useMerchantPrefs } from "@/lib/hooks/use-merchant-prefs";
import { useAlertSound, vibrate } from "@/lib/hooks/use-alert-sound";
import { useNotifyPermission } from "@/lib/hooks/use-notify-permission";
import { useOrderRealtime } from "@/lib/hooks/use-order-realtime";
import { useWakeLock } from "@/lib/hooks/use-wake-lock";
import { notify } from "@/lib/native";
import { createClient } from "@/lib/supabase/client";
import { updateOrderStatus } from "@/app/(merchant)/orders/actions";
import { printOrderTicket } from "@/lib/ticket/print-order";
import { fetchCategoryMap } from "@/lib/ticket/category-map";
import type { TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { OrderStatus, PrintSettings } from "@/lib/types";
import {
  CounterAlertOverlay,
  type CounterAlertOrder,
} from "@/components/merchant/counter-alert-overlay";

type IncomingOrder = {
  id: string;
  customer_name: string | null;
  total_da: number | null;
};

type Props = {
  merchantId: string;
  merchantName: string;
  printSettings: PrintSettings;
};

/**
 * Pont Realtime « ambient » — monté UNE FOIS par `MerchantShell` (donc actif
 * sur toutes les pages commerçant : dashboard, orders, catalog, finances…).
 * Le commerçant ne rate jamais une commande, où qu'il soit dans l'app.
 *
 * Sur INSERT d'une commande :
 *  - joue `alert.wav` (en boucle si `prefs.counterMode`)
 *  - vibration insistante en counterMode (no-op iOS)
 *  - notifie le système si `prefs.notifications` ET permission accordée
 *  - overlay plein écran (counterMode) ou toast (sinon)
 *  - si `print.auto_accept_orders`, transition pending → preparing
 *  - si `print.auto_print === 'on_receive'`, imprime le ticket
 *  - `router.refresh()` → revalide les Server Components de la page courante
 *    (dashboard / orders / orders/[id]) → la liste de commandes se met à jour
 *    automatiquement sans que l'utilisateur ait à rafraîchir
 *
 * Sur UPDATE :
 *  - `router.refresh()` idem
 *  - si `print.auto_print === 'on_accept'` ET la commande passe en
 *    accepted/preparing pour la première fois, imprime
 *
 * Dé-doublonnage : on garde un Set d'orderId déjà imprimés par session pour
 * éviter qu'un ré-événement (reconnexion Realtime) ne produise une 2e copie.
 */
export function OrderRealtimeBridge({
  merchantId,
  merchantName,
  printSettings,
}: Props) {
  const router = useRouter();
  const { prefs, hydrated } = useMerchantPrefs();
  const { play, stop, unlock, unlocked } = useAlertSound();
  const { permission, request } = useNotifyPermission();
  // Wake lock activé tant que counterMode est ON — pas de variable retournée,
  // le hook se réacquiert tout seul après visibilitychange.
  useWakeLock(prefs.counterMode);
  const [toastOrder, setToastOrder] = useState<IncomingOrder | null>(null);
  const [counterOrder, setCounterOrder] = useState<CounterAlertOrder | null>(
    null
  );
  const printedOnceRef = useRef<Set<string>>(new Set());

  // Auto-unlock au PREMIER clic n'importe où : on déverrouille l'audio et on
  // déclenche la demande de permission notifications. C'est ce qui permet à
  // « son ON » et « notifs ON » d'être réellement actifs sans que le
  // commerçant ait à cliquer sur des boutons dédiés.
  //
  // En phase « bubble » (pas capture) et sur `pointerup` plutôt que
  // `pointerdown` : le handler tourne APRÈS les handlers de l'UI courante,
  // ce qui évite que le prompt système Android (POST_NOTIFICATIONS) ne
  // sabote un click en cours — symptôme observé sur WebView Sunmi où le
  // drawer pouvait rester collé. Le `request()` est en plus différé d'un
  // tick pour ne pas attraper le focus pendant qu'un drawer / modal anime
  // sa fermeture.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let done = false;
    const handler = () => {
      if (done) return;
      done = true;
      if (prefs.alertSound && !unlocked) void unlock();
      if (
        prefs.notifications &&
        permission !== "granted" &&
        permission !== "denied" &&
        permission !== "unsupported"
      ) {
        window.setTimeout(() => void request(), 0);
      }
      window.removeEventListener("pointerup", handler);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("pointerup", handler);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("pointerup", handler);
      window.removeEventListener("keydown", handler);
    };
  }, [
    prefs.alertSound,
    prefs.notifications,
    unlocked,
    permission,
    unlock,
    request,
  ]);

  // Snapshot des réglages : on n'écoute pas leur mutation pendant la session ;
  // le commerçant doit recharger pour appliquer (les changements de réglages
  // déclenchent eux-mêmes une revalidation côté serveur via `setPrintSettings`).
  const settingsRef = useRef(printSettings);

  /** Récupère la commande complète (+ items + catégories) pour l'imprimer. */
  const fetchTicket = useCallback(
    async (orderId: string): Promise<TicketOrder | null> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("orders")
        .select(
          `id, customer_name, customer_phone, pickup_code, pickup_slot_at,
           created_at, notes, total_da, service_fee_da, cashback_da,
           payment_method, payment_status,
           order_items ( product_name, unit_price_da, quantity, line_total_da )`
        )
        .eq("id", orderId)
        .maybeSingle();
      if (!data) return null;
      const names = (data.order_items ?? []).map((it) => it.product_name);
      const categoryMap = await fetchCategoryMap(supabase, merchantId, names);
      return {
        id: data.id,
        merchant_name: merchantName,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        pickup_code: data.pickup_code,
        pickup_slot_at: data.pickup_slot_at,
        created_at: data.created_at,
        notes: data.notes,
        total_da: data.total_da,
        service_fee_da: data.service_fee_da,
        cashback_da: data.cashback_da,
        payment_method: data.payment_method,
        payment_status: data.payment_status,
        items: (data.order_items ?? []).map((it) => ({
          product_name: it.product_name,
          quantity: Number(it.quantity),
          unit_price_da: it.unit_price_da,
          line_total_da: it.line_total_da,
          category_name: categoryMap[it.product_name],
        })),
      };
    },
    [merchantName, merchantId]
  );

  const doPrint = useCallback(
    async (orderId: string) => {
      if (printedOnceRef.current.has(orderId)) return;
      printedOnceRef.current.add(orderId);
      // Les `order_items` peuvent arriver après l'INSERT sur `orders` ;
      // un petit délai laisse la transaction se poser côté DB.
      await new Promise((r) => setTimeout(r, 300));
      const ticket = await fetchTicket(orderId);
      if (!ticket) return;
      try {
        await printOrderTicket(ticket, {
          width: settingsRef.current.print_width,
          copies: settingsRef.current.print_copies,
        });
      } catch {
        // Pas de toast bruyant : l'impression auto est silencieuse par
        // construction, et le commerçant peut toujours rejouer manuellement.
      }
    },
    [fetchTicket]
  );

  const handleInsert = useCallback(
    async (row: {
      id: string;
      customer_name: string | null;
      total_da: number | null;
      status: string;
    }) => {
      if (prefs.alertSound) {
        await play({ repeat: prefs.counterMode, intervalMs: 1500 });
      }
      if (prefs.counterMode) {
        // Vibration insistante (no-op iOS).
        vibrate([300, 150, 300, 150, 300]);
      }
      if (prefs.notifications && permission === "granted") {
        const title = "Nouvelle commande Coligo";
        const body =
          (row.customer_name ?? "Client") +
          (row.total_da != null ? ` · ${formatDA(row.total_da)}` : "");
        notify(title, { body, tag: "coligo-order" });
      }
      if (prefs.counterMode) {
        setCounterOrder({
          id: row.id,
          customer_name: row.customer_name,
          total_da: row.total_da,
        });
      } else {
        setToastOrder({
          id: row.id,
          customer_name: row.customer_name,
          total_da: row.total_da,
        });
        window.setTimeout(() => setToastOrder(null), 8000);
      }

      const s = settingsRef.current;
      // Auto-accept : on valide la commande dès sa réception (transition
      // autorisée pending → preparing par `nextOrderAction`).
      if (s.auto_accept_orders && row.status === "pending") {
        const opId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `auto-${row.id}-${Date.now()}`;
        void updateOrderStatus(row.id, "preparing" as OrderStatus, opId);
      }
      if (s.auto_print === "on_receive") {
        void doPrint(row.id);
      }
      router.refresh();
    },
    [
      prefs.alertSound,
      prefs.notifications,
      prefs.counterMode,
      permission,
      play,
      router,
      doPrint,
    ]
  );

  const dismissCounter = useCallback(() => {
    stop();
    setCounterOrder(null);
  }, [stop]);

  const printFromCounter = useCallback(
    (orderId: string) => {
      void doPrint(orderId);
      dismissCounter();
    },
    [doPrint, dismissCounter]
  );

  const handleUpdate = useCallback(
    (row: { id: string; status: string }) => {
      router.refresh();
      const s = settingsRef.current;
      // « À l'acceptation » couvre aussi 'accepted' (au cas où l'app passe par
      // cet état) ET 'preparing' (transition principale pending → preparing).
      if (
        s.auto_print === "on_accept" &&
        (row.status === "accepted" || row.status === "preparing")
      ) {
        void doPrint(row.id);
      }
    },
    [router, doPrint]
  );

  const realtimeStatus = useOrderRealtime(merchantId, {
    onInsert: handleInsert,
    onUpdate: handleUpdate,
  });

  // Ceinture-bretelle : si Realtime n'est PAS connecté (timeout, websocket
  // bloqué par un proxy, etc.) ou si on est en Mode comptoir, on revalide
  // périodiquement la route. Coût quasi-nul (Server Components, RLS), garantit
  // qu'on ne reste pas bloqué sur un canal mort sans s'en rendre compte.
  useEffect(() => {
    const intervalMs =
      realtimeStatus === "connected"
        ? prefs.counterMode
          ? 30_000 // counterMode + RT OK : check toutes les 30 s par sécurité
          : 0 // RT OK hors counterMode : pas de polling
        : 8_000; // RT KO : polling agressif 8 s
    if (intervalMs === 0) return;
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [realtimeStatus, prefs.counterMode, router]);

  if (!hydrated) return null;

  const needsAudioUnlock = prefs.alertSound && !unlocked;
  const realtimeOk = realtimeStatus === "connected";

  return (
    <>
      {/* Mini toolbar de diagnostic fixée en bas-droite — laisse au commerçant
          un signal clair que les alertes sont prêtes (point vert) ou pas
          (point rouge), et le moyen de débloquer le son d'un seul tap si
          jamais l'auto-unlock n'a pas pu s'amorcer.
          Caché si tout est OK ET pas en counterMode → 99 % du temps invisible. */}
      {(needsAudioUnlock || !realtimeOk) && (
        <div className="fixed right-3 bottom-24 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-black/10 bg-white/95 px-3 py-2 shadow-lg backdrop-blur sm:bottom-4">
          <span
            className={
              "inline-block size-2 rounded-full " +
              (realtimeOk ? "bg-green-500" : "animate-pulse bg-red-500")
            }
            title={"Realtime " + realtimeStatus}
            aria-label={"Realtime " + realtimeStatus}
          />
          <span className="text-foreground text-xs font-medium">
            {realtimeOk ? "Alertes prêtes" : "Reconnexion…"}
          </span>
          {needsAudioUnlock && (
            <button
              type="button"
              onClick={unlock}
              className="bg-primary-600 text-primary-50 hover:bg-primary-700 ml-1 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold"
            >
              <Volume2 className="size-3.5" />
              Activer le son
            </button>
          )}
        </div>
      )}

      {/* Overlay plein écran « Mode comptoir » — exige un clic pour se fermer. */}
      <CounterAlertOverlay
        order={counterOrder}
        onDismiss={dismissCounter}
        onPrint={printFromCounter}
        canPrint={settingsRef.current.auto_print !== "off"}
      />

      {/* Toast in-app (custom, distinct du Toaster global pour porter l'accent commande) */}
      {toastOrder && (
        <div
          role="status"
          className="bg-primary-600 fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-start gap-3 rounded-[14px] px-4 py-3 text-white shadow-xl sm:right-4 sm:bottom-4 sm:left-auto sm:mx-0"
        >
          <PartyPopper className="text-warning-300 mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Nouvelle commande !</p>
            <p className="text-primary-100 mt-0.5 truncate text-xs">
              {toastOrder.customer_name ?? "Client"}
              {toastOrder.total_da != null
                ? ` · ${formatDA(toastOrder.total_da)}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setToastOrder(null)}
            aria-label="Fermer"
            className="text-primary-100 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </>
  );
}
