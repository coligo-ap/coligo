"use client";

import { useState } from "react";
import { Bell, Menu } from "lucide-react";
import { driverDrawer } from "@/components/driver/driver-drawer-store";
import { DriverNotificationsSheet } from "@/components/driver/notifications/driver-notifications-sheet";

/**
 * Top bar flottante de l'accueil (au-dessus de la carte) : bouton menu rond
 * (ouvre le drawer existant), pill « En ligne / Hors ligne », bouton cloche
 * (ouvre la feuille Notifications).
 */
export function DriverHomeTopbar({ online }: { online: boolean }) {
  const [notifOpen, setNotifOpen] = useState(false);
  return (
    <>
      <div className="absolute inset-x-3.5 top-[max(46px,calc(env(safe-area-inset-top)+12px))] z-50 flex items-center justify-between">
        <button
          type="button"
          onClick={() => driverDrawer.toggle()}
          aria-label="Ouvrir le menu"
          className="grid size-11 place-items-center rounded-full bg-white text-[#0a0a0a] shadow-[0_4px_12px_rgba(0,0,0,.1)] active:scale-95"
        >
          <Menu className="size-5" />
        </button>

        <span className="inline-flex items-center gap-2.5 rounded-full bg-white px-[18px] py-2.5 text-sm font-bold shadow-[0_4px_12px_rgba(0,0,0,.1)]">
          <span className="relative grid size-2.5 place-items-center">
            <span
              className={
                "size-2.5 rounded-full " +
                (online ? "bg-[#00a86b]" : "bg-[#9e9e9e]")
              }
            />
            {online && (
              <span className="absolute size-2.5 animate-ping rounded-full bg-[#00a86b]" />
            )}
          </span>
          <span className={online ? "text-[#00a86b]" : "text-[#757575]"}>
            {online ? "En ligne" : "Hors ligne"}
          </span>
        </span>

        <button
          type="button"
          onClick={() => setNotifOpen(true)}
          aria-label="Notifications"
          className="grid size-11 place-items-center rounded-full bg-white text-[#0a0a0a] shadow-[0_4px_12px_rgba(0,0,0,.1)] active:scale-95"
        >
          <Bell className="size-5" />
        </button>
      </div>

      <DriverNotificationsSheet
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
      />
    </>
  );
}
