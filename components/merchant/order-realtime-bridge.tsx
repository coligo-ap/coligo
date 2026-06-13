"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Volume2 } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { useMerchantPrefs } from "@/lib/hooks/use-merchant-prefs";
import { useAlertSound, vibrate } from "@/lib/hooks/use-alert-sound";
import { useNotifyPermission } from "@/lib/hooks/use-notify-permission";
import { useOrderRealtime } from "@/lib/hooks/use-order-realtime";
import { useWakeLock } from "@/lib/hooks/use-wake-lock";
import { notify } from "@/lib/native";
import { createClient } from "@/lib/supabase/client";
import { printOrderTicket } from "@/lib/ticket/print-order";
import { fetchCategoryMap } from "@/lib/ticket/category-map";
import { fetchCustomerOrderCount } from "@/lib/ticket/customer-orders";
import type { TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { PrintSettings } from "@/lib/types";
import {
  NewOrderOverlay,
  type NewOrder,
} from "@/components/merchant/new-order-overlay";

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
 *  - joue `alert.wav` (en boucle tant qu'une commande est en attente)
 *  - vibration insistante (no-op iOS)
 *  - notifie le système si `prefs.notifications` ET permission accordée
 *  - empile la commande dans une file affichée en OVERLAY PLEIN ÉCRAN, partout
 *    dans l'app, avec Accepter/Refuser. Si `auto_accept_orders` est ON, un
 *    compte-à-rebours de 10 s accepte tout seul ; sinon refus auto à 15 min.
 *    (la logique de minuterie/transition vit dans `NewOrderOverlay`)
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
  // File des commandes à confirmer, affichées une par une en overlay plein
  // écran. On empile sur chaque INSERT et on dépile à l'acceptation/refus.
  const [queue, setQueue] = useState<NewOrder[]>([]);
  // Alerte « commande annulée par le client » (pop-up rouge plein écran).
  const [cancelledAlert, setCancelledAlert] = useState<{
    id: string;
    ref: string;
    name: string | null;
  } | null>(null);
  const printedOnceRef = useRef<Set<string>>(new Set());
  // Commandes déjà signalées (son/notif) — pour n'alerter qu'UNE fois par
  // commande, quel que soit le canal qui la remonte (Realtime ou polling).
  const alertedRef = useRef<Set<string>>(new Set());

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
           payment_method, payment_status, fulfillment_type,
           delivery_address_text, delivery_phone, delivery_note,
           order_items ( product_name, unit_price_da, quantity, line_total_da )`
        )
        .eq("id", orderId)
        .maybeSingle();
      if (!data) return null;
      const names = (data.order_items ?? []).map((it) => it.product_name);
      const categoryMap = await fetchCategoryMap(supabase, merchantId, names);
      const customerOrderCount = await fetchCustomerOrderCount(
        supabase,
        merchantId,
        data.customer_phone
      );
      return {
        id: data.id,
        merchant_name: merchantName,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        customer_order_count: customerOrderCount,
        pickup_code: data.pickup_code,
        pickup_slot_at: data.pickup_slot_at,
        created_at: data.created_at,
        notes: data.notes,
        total_da: data.total_da,
        service_fee_da: data.service_fee_da,
        cashback_da: data.cashback_da,
        payment_method: data.payment_method,
        payment_status: data.payment_status,
        fulfillment_type: data.fulfillment_type ?? "pickup",
        delivery_address: data.delivery_address_text ?? null,
        delivery_phone: data.delivery_phone ?? null,
        delivery_note: data.delivery_note ?? null,
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

  // Empile une/des commande(s) « à confirmer » dans la file de l'overlay (sans
  // doublon) et déclenche l'alerte (son en boucle + vibration + notif) UNE seule
  // fois par commande — quel que soit le canal (Realtime OU polling) qui la
  // remonte. C'est le point d'entrée unique de l'overlay.
  const addPending = useCallback(
    (orders: NewOrder[]) => {
      if (orders.length === 0) return;
      setQueue((q) => {
        const ids = new Set(q.map((o) => o.id));
        const fresh = orders.filter((o) => !ids.has(o.id));
        return fresh.length ? [...q, ...fresh] : q;
      });
      const newOnes = orders.filter((o) => !alertedRef.current.has(o.id));
      if (newOnes.length === 0) return;
      newOnes.forEach((o) => alertedRef.current.add(o.id));
      if (prefs.alertSound) void play({ repeat: true, intervalMs: 1500 });
      vibrate([300, 150, 300, 150, 300]);
      if (prefs.notifications && permission === "granted") {
        const o = newOnes[0];
        notify("Nouvelle commande Coligo", {
          body:
            (o.customer_name ?? "Client") +
            (o.total_da != null ? ` · ${formatDA(o.total_da)}` : ""),
          tag: "coligo-order",
        });
      }
    },
    [prefs.alertSound, prefs.notifications, permission, play]
  );

  const handleInsert = useCallback(
    async (row: {
      id: string;
      customer_name: string | null;
      total_da: number | null;
      status: string;
      order_number?: string | null;
      payment_method?: string | null;
      payment_status?: string | null;
    }) => {
      // SÉCURITÉ PAIEMENT : une commande payée EN LIGNE pas encore confirmée ne
      // doit RIEN déclencher (ni overlay, ni son, ni impression). Le webhook
      // Chargily la rendra effective (UPDATE -> handleUpdate) une fois payée.
      // La RLS la masque déjà aux requêtes ; ce garde couvre le cas où Realtime
      // livrerait quand même l'INSERT.
      if (row.payment_method === "online" && row.payment_status !== "paid") {
        return;
      }
      // Seules les commandes à confirmer ouvrent l'overlay (les autres INSERT
      // éventuels — imports, etc. — ne doivent pas bloquer l'écran).
      if (row.status !== "pending") {
        if (settingsRef.current.auto_print === "on_receive")
          void doPrint(row.id);
        router.refresh();
        return;
      }
      addPending([
        {
          id: row.id,
          customer_name: row.customer_name,
          total_da: row.total_da,
          order_number: row.order_number ?? null,
        },
      ]);
      if (settingsRef.current.auto_print === "on_receive") {
        void doPrint(row.id);
      }
      router.refresh();
    },
    [addPending, router, doPrint]
  );

  // Sondage ACTIF des commandes « à confirmer ». Filet indispensable : si le
  // Realtime se déclare connecté mais ne livre pas les INSERT (RLS/proxy/WebView),
  // la pop-up doit quand même surgir sur N'IMPORTE QUELLE page commerçant, sans
  // que le commerçant ait à rafraîchir. Couvre aussi les commandes déjà en
  // attente à l'ouverture de l'app. Realtime reste le chemin « instantané ».
  useEffect(() => {
    if (!merchantId) return;
    let cancelled = false;
    const supabase = createClient();
    const poll = async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, customer_name, total_da, order_number")
        .eq("merchant_id", merchantId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (cancelled || !data || data.length === 0) return;
      addPending(
        data.map((r) => ({
          id: r.id,
          customer_name: r.customer_name,
          total_da: r.total_da,
          order_number: r.order_number ?? null,
        }))
      );
    };
    void poll();
    const id = window.setInterval(() => void poll(), 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [merchantId, addPending]);

  // Retire la commande de tête une fois acceptée/refusée → affiche la suivante.
  const resolveHead = useCallback(() => {
    setQueue((q) => q.slice(1));
    router.refresh();
  }, [router]);

  const printFromOverlay = useCallback(
    (orderId: string) => {
      void doPrint(orderId);
    },
    [doPrint]
  );

  // Coupe le son d'alerte dès que la file est vide (plus rien à confirmer).
  useEffect(() => {
    if (queue.length === 0) stop();
  }, [queue.length, stop]);

  const handleUpdate = useCallback(
    (row: {
      id: string;
      status: string;
      customer_name?: string | null;
      total_da?: number | null;
      order_number?: string | null;
      payment_method?: string | null;
      payment_status?: string | null;
      cancelled_by?: string | null;
    }) => {
      router.refresh();
      const s = settingsRef.current;

      // ANNULATION PAR LE CLIENT (avant acceptation) : on retire la commande de
      // la file de confirmation si elle y est, et on affiche une pop-up rouge
      // « ne pas préparer » + son + vibration + notif système.
      if (row.status === "cancelled" && row.cancelled_by === "customer") {
        setQueue((q) => q.filter((o) => o.id !== row.id));
        const ref = row.order_number ?? row.id.slice(0, 6).toUpperCase();
        setCancelledAlert({ id: row.id, ref, name: row.customer_name ?? null });
        if (prefs.alertSound) void play({ repeat: false });
        vibrate([200, 100, 200, 100, 400]);
        if (prefs.notifications && permission === "granted") {
          notify("Commande annulée", {
            body: `#${ref} annulée par le client — ne pas la préparer.`,
            tag: "coligo-cancel",
          });
        }
        return;
      }
      // Une commande online qui vient d'être PAYÉE (webhook → payment_status
      // 'paid') devient effective : son UPDATE arrive ici avec status 'pending'.
      // On l'empile alors comme une nouvelle commande à confirmer (overlay +
      // son + impression on_receive). Le polling 6 s est le filet de secours.
      const effectiveNow = !(
        row.payment_method === "online" && row.payment_status !== "paid"
      );
      if (row.status === "pending" && effectiveNow) {
        addPending([
          {
            id: row.id,
            customer_name: row.customer_name ?? null,
            total_da: row.total_da ?? null,
            order_number: row.order_number ?? null,
          },
        ]);
        if (s.auto_print === "on_receive") void doPrint(row.id);
        return;
      }
      // « À l'acceptation » couvre aussi 'accepted' (au cas où l'app passe par
      // cet état) ET 'preparing' (transition principale pending → preparing).
      if (
        s.auto_print === "on_accept" &&
        (row.status === "accepted" || row.status === "preparing")
      ) {
        void doPrint(row.id);
      }
    },
    [
      router,
      doPrint,
      addPending,
      prefs.alertSound,
      prefs.notifications,
      permission,
      play,
    ]
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

      {/* Overlay plein écran « Nouvelle commande ! » — affiché partout dans
          l'app dès qu'une commande à confirmer arrive. Accepter/Refuser, ou
          compte-à-rebours auto selon le réglage. */}
      <NewOrderOverlay
        order={queue[0] ?? null}
        merchantId={merchantId}
        queued={Math.max(0, queue.length - 1)}
        autoAccept={settingsRef.current.auto_accept_orders}
        onResolved={resolveHead}
        onPrint={printFromOverlay}
        canPrint={settingsRef.current.auto_print !== "off"}
      />

      {/* Pop-up « commande annulée par le client » — plein écran rouge. */}
      {cancelledAlert && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Commande annulée par le client"
          className="bg-danger-700/95 fixed inset-0 z-[97] flex items-center justify-center p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-[20px] bg-white p-6 text-center shadow-2xl">
            <div className="bg-danger-100 text-danger-700 mx-auto grid size-14 place-items-center rounded-full">
              <Ban className="size-7" />
            </div>
            <h2 className="text-foreground mt-3 text-xl font-bold">
              Commande annulée
            </h2>
            <p className="text-muted mt-1.5 text-sm">
              La commande{" "}
              <span className="text-foreground font-bold">
                #{cancelledAlert.ref}
              </span>
              {cancelledAlert.name ? ` de ${cancelledAlert.name}` : ""} a été
              annulée par le client.{" "}
              <strong className="text-danger-700">Ne pas la préparer.</strong>
            </p>
            <button
              type="button"
              onClick={() => setCancelledAlert(null)}
              className="bg-foreground mt-5 inline-flex h-12 w-full items-center justify-center rounded-[14px] text-base font-bold text-white"
            >
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
}
