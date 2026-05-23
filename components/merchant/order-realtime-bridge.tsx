"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, PartyPopper, Volume2, VolumeX, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { useMerchantPrefs } from "@/lib/hooks/use-merchant-prefs";
import { useAlertSound } from "@/lib/hooks/use-alert-sound";
import { useNotifyPermission } from "@/lib/hooks/use-notify-permission";
import { useOrderRealtime } from "@/lib/hooks/use-order-realtime";
import { notify } from "@/lib/native";

type IncomingOrder = {
  id: string;
  customer_name: string | null;
  total_da: number | null;
};

/**
 * Pont Realtime + son + notif + toast pour le dashboard commerçant.
 *
 * Sur INSERT d'une commande :
 *  - joue `alert.wav` si `prefs.alertSound`
 *  - déclenche `notify()` si `prefs.notifications` ET permission accordée
 *  - affiche un toast violet `#5C5CE0` dans la page
 *  - rafraîchit la route pour ré-hydrater le Kanban (source de vérité côté serveur)
 *
 * Le panneau de réglages compact propose deux toggles (Son / Notifs) et,
 * conditionnellement, les boutons « Activer le son » (déblocage autoplay) et
 * « Autoriser les notifications ».
 */
export function OrderRealtimeBridge({ merchantId }: { merchantId: string }) {
  const router = useRouter();
  const { prefs, update, hydrated } = useMerchantPrefs();
  const { play, unlock, unlocked } = useAlertSound();
  const { permission, request } = useNotifyPermission();
  const [toastOrder, setToastOrder] = useState<IncomingOrder | null>(null);

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
      router.refresh();
    },
    [prefs.alertSound, prefs.notifications, permission, play, router]
  );

  const handleUpdate = useCallback(() => {
    router.refresh();
  }, [router]);

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
