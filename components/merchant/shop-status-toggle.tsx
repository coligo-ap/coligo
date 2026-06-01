"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Clock, Loader2, Power } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { setShopPause, type ShopPauseMode } from "@/app/(merchant)/actions";
import {
  computePauseState,
  type MerchantPauseInput,
} from "@/lib/merchant/pause-state";

/**
 * Bouton header « Ouvert / En pause / Fermé » avec menu d'options :
 *  - Pause 30 min / 1 h / 2 h (réouverture automatique) ;
 *  - Fermer aujourd'hui (jusqu'à demain) ;
 *  - Fermer (jusqu'à réouverture manuelle).
 * Une fermeture immédiate ne dépasse jamais la journée — au-delà, le commerçant
 * programme une fermeture dans ses paramètres.
 */
export function ShopStatusToggle({ input }: { input: MerchantPauseInput }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const rootRef = useRef<HTMLDivElement>(null);

  // Recalcule l'état dans le temps (la pause temporaire expire toute seule).
  useEffect(() => {
    setMounted(true);
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Ferme le menu au clic extérieur.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Premier rendu déterministe (SSR = client) basé sur orders_paused seul ;
  // après montage, on calcule l'état précis (avec paused_until / fermeture).
  const state = mounted
    ? computePauseState(input, now)
    : {
        closedNow: !!input.orders_paused,
        reason: input.orders_paused
          ? ("paused_indefinite" as const)
          : ("open" as const),
        reopensAt: null,
      };

  const closed = state.closedNow;
  const reopenLabel =
    state.reopensAt &&
    state.reopensAt.toLocaleTimeString("fr-DZ", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Algiers",
    });

  function act(mode: ShopPauseMode) {
    setMenuOpen(false);
    start(async () => {
      const r = await setShopPause(mode);
      if (!r.ok) {
        toast.error(r.error ?? "Impossible de changer le statut.");
        return;
      }
      toast.success(
        mode === "open" ? "Boutique ouverte ✓" : "Statut mis à jour"
      );
      router.refresh();
    });
  }

  const label = !closed
    ? "Ouvert"
    : state.reason === "paused_temp" && reopenLabel
      ? `Pause · ${reopenLabel}`
      : "Fermé";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60",
          closed
            ? "border-danger-300 bg-danger-50 text-danger-700"
            : "border-success-300 bg-success-50 text-success-700"
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <span
            className={cn(
              "size-2 rounded-full",
              closed ? "bg-danger-500" : "bg-success-500 animate-pulse"
            )}
          />
        )}
        {label}
        <ChevronDown className="size-3.5 opacity-70" />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="border-border absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-[14px] border bg-white shadow-lg"
        >
          {closed ? (
            <MenuItem onClick={() => act("open")} highlight>
              <Power className="size-4" />
              Ouvrir maintenant
            </MenuItem>
          ) : (
            <>
              <p className="text-subtle px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                Mettre en pause
              </p>
              <MenuItem onClick={() => act("pause_30m")}>
                <Clock className="size-4" />
                Pause 30 min
              </MenuItem>
              <MenuItem onClick={() => act("pause_1h")}>
                <Clock className="size-4" />
                Pause 1 heure
              </MenuItem>
              <MenuItem onClick={() => act("pause_2h")}>
                <Clock className="size-4" />
                Pause 2 heures
              </MenuItem>
              <div className="border-border border-t" />
              <MenuItem onClick={() => act("close_today")}>
                <Power className="size-4" />
                Fermer aujourd&apos;hui
              </MenuItem>
              <MenuItem onClick={() => act("close_indefinite")} danger>
                <Power className="size-4" />
                Fermer (jusqu&apos;à réouverture)
              </MenuItem>
            </>
          )}
          <div className="border-border bg-surface-2 border-t px-3 py-2">
            <p className="text-subtle text-[11px] leading-snug">
              Pour fermer plusieurs jours (congés), programmez une fermeture
              dans <span className="font-medium">Paramètres → Horaires</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  highlight,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "hover:bg-surface-2 flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium transition-colors",
        highlight && "text-success-700",
        danger && "text-danger-700"
      )}
    >
      {children}
    </button>
  );
}
