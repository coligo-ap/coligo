"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, PartyPopper, Volume2, VolumeX, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { useMerchantPrefs } from "@/lib/hooks/use-merchant-prefs";
import { useAlertSound } from "@/lib/hooks/use-alert-sound";
import { useNotifyPermission } from "@/lib/hooks/use-notify-permission";
import { useOrderRealtime } from "@/lib/hooks/use-order-realtime";
import { notify } from "@/lib/native";
import { createClient } from "@/lib/supabase/client";
import { updateOrderStatus } from "@/app/(merchant)/orders/actions";
import { printOrderTicket } from "@/lib/ticket/print-order";
import type { TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { OrderStatus, PrintSettings } from "@/lib/types";

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
 * Pont Realtime + son + notif + auto-accept + auto-print pour le dashboard.
 *
 * Sur INSERT d'une commande :
 *  - joue `alert.wav` si `prefs.alertSound`
 *  - notifie le système si `prefs.notifications` ET permission accordée
 *  - affiche un toast violet `#5C5CE0`
 *  - si `print.auto_accept_orders`, déclenche la transition pending → preparing
 *  - si `print.auto_print === 'on_receive'`, imprime le ticket
 *  - rafraîchit la route (le Kanban est ré-hydraté depuis le serveur)
 *
 * Sur UPDATE :
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
  const { prefs, update, hydrated } = useMerchantPrefs();
  const { play, unlock, unlocked } = useAlertSound();
  const { permission, request } = useNotifyPermission();
  const [toastOrder, setToastOrder] = useState<IncomingOrder | null>(null);
  const printedOnceRef = useRef<Set<string>>(new Set());
  // Snapshot des réglages : on n'écoute pas leur mutation pendant la session ;
  // le commerçant doit recharger pour appliquer (les changements de réglages
  // déclenchent eux-mêmes une revalidation côté serveur via `setPrintSettings`).
  const settingsRef = useRef(printSettings);

  /** Récupère la commande complète (+ items + nom du commerce) pour l'imprimer. */
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
        })),
      };
    },
    [merchantName]
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
      if (prefs.alertSound) await play();
      if (prefs.notifications && permission === "granted") {
        const title = "Nouvelle commande Coligo";
        const body =
          (row.customer_name ?? "Client") +
          (row.total_da != null ? ` · ${formatDA(row.total_da)}` : "");
        notify(title, { body, tag: "coligo-order" });
      }
      setToastOrder({
        id: row.id,
        customer_name: row.customer_name,
        total_da: row.total_da,
      });
      window.setTimeout(() => setToastOrder(null), 8000);

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
    [prefs.alertSound, prefs.notifications, permission, play, router, doPrint]
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

  useOrderRealtime(merchantId, {
    onInsert: handleInsert,
    onUpdate: handleUpdate,
  });

  if (!hydrated) return null;

  const needsAudioUnlock = prefs.alertSound && !unlocked;
  const needsNotifPrompt =
    prefs.notifications &&
    permission !== "granted" &&
    permission !== "unsupported";

  return (
    <>
      {/* Panneau de réglages compact */}
      <div className="border-border bg-surface mb-4 flex flex-wrap items-center gap-2 rounded-[12px] border p-3">
        <span className="text-muted mr-1 text-xs font-medium tracking-wide uppercase">
          Alertes
        </span>

        <Chip
          active={prefs.alertSound}
          onClick={() => update({ alertSound: !prefs.alertSound })}
          activeIcon={Volume2}
          inactiveIcon={VolumeX}
          activeLabel="Son ON"
          inactiveLabel="Son OFF"
        />
        <Chip
          active={prefs.notifications}
          onClick={() => update({ notifications: !prefs.notifications })}
          activeIcon={Bell}
          inactiveIcon={BellOff}
          activeLabel="Notifs ON"
          inactiveLabel="Notifs OFF"
        />

        {needsAudioUnlock && (
          <button
            type="button"
            onClick={unlock}
            className="text-primary-700 border-primary-200 hover:bg-primary-50 ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-medium"
          >
            <Volume2 className="size-3.5" />
            Activer le son
          </button>
        )}
        {needsNotifPrompt && (
          <button
            type="button"
            onClick={() => void request()}
            className={cn(
              "text-primary-700 border-primary-200 hover:bg-primary-50 inline-flex h-8 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-medium",
              !needsAudioUnlock && "ml-auto"
            )}
          >
            <Bell className="size-3.5" />
            Autoriser les notifications
          </button>
        )}
      </div>

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

function Chip({
  active,
  onClick,
  activeIcon: ActiveIcon,
  inactiveIcon: InactiveIcon,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  onClick: () => void;
  activeIcon: React.ComponentType<{ className?: string }>;
  inactiveIcon: React.ComponentType<{ className?: string }>;
  activeLabel: string;
  inactiveLabel: string;
}) {
  const Icon = active ? ActiveIcon : InactiveIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
        active
          ? "bg-primary-50 text-primary-700 border-primary-200 border"
          : "bg-surface-3 text-muted hover:text-foreground border-border border"
      )}
    >
      <Icon className="size-3.5" />
      {active ? activeLabel : inactiveLabel}
    </button>
  );
}
