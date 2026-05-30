"use client";

import { X } from "lucide-react";
import { DriverNotificationsPanel } from "./notifications-panel";

/**
 * Feuille « Notifications » du livreur (ouverte par la cloche de l'accueil).
 * Overlay bas + backdrop. Contenu = DriverNotificationsPanel.
 */
export function DriverNotificationsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[85]">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-[20px] bg-white pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,.15)]">
        <div className="mx-auto mt-2 mb-1 h-1.5 w-11 rounded-full bg-[#d8d8d8]" />
        <header className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[18px] font-extrabold text-[#0a0a0a]">
            Notifications
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-9 place-items-center rounded-full bg-[#f5f5f5] text-[#0a0a0a] active:scale-95"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-4 pb-2">
          <DriverNotificationsPanel />
        </div>
      </div>
    </div>
  );
}
