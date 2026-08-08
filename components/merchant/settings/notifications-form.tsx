"use client";

import { Loader2, Volume2 } from "lucide-react";
import { useState } from "react";
import { useMerchantPrefs } from "@/lib/hooks/use-merchant-prefs";
import { useNotifyPermission } from "@/lib/hooks/use-notify-permission";
import { useAlertSound } from "@/lib/hooks/use-alert-sound";
import { cn } from "@/lib/utils";

/**
 * Réglages des alertes commerçant — son, notifications système et « Mode
 * comptoir ». Ces préférences pilotent réellement le pont Realtime
 * (`OrderRealtimeBridge`) : son joué en boucle, notif système, écran maintenu
 * allumé. Persistées en localStorage par appareil (cf. `useMerchantPrefs`).
 */
export function NotificationsForm() {
  const { prefs, update, hydrated } = useMerchantPrefs();
  const { permission, request } = useNotifyPermission();
  const { unlock, play, stop } = useAlertSound();
  const [testing, setTesting] = useState(false);

  if (!hydrated) {
    return (
      <p className="text-muted flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Chargement…
      </p>
    );
  }

  const testSound = async () => {
    setTesting(true);
    await unlock();
    await play();
    window.setTimeout(() => {
      stop();
      setTesting(false);
    }, 2500);
  };

  return (
    <div className="space-y-1">
      <ToggleRow
        label="Son d'alerte"
        description="Joue un son à chaque nouvelle commande, en boucle tant qu'une commande n'est pas confirmée."
        checked={prefs.alertSound}
        onChange={(v) => update({ alertSound: v })}
      />
      <ToggleRow
        label="Notifications système"
        description="Affiche une notification de l'appareil même si tu regardes un autre onglet."
        checked={prefs.notifications}
        onChange={(v) => update({ notifications: v })}
      />
      <ToggleRow
        label="Mode comptoir"
        description="Garde l'écran allumé et insiste (son en boucle + plein écran) pour ne rater aucune commande pendant le service."
        checked={prefs.counterMode}
        onChange={(v) => update({ counterMode: v })}
      />

      {/* Permission notifications système */}
      {prefs.notifications && permission !== "granted" && (
        <div className="border-warning-200 bg-warning-50 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
          <p className="text-warning-800 text-sm">
            {permission === "denied"
              ? "Les notifications sont bloquées dans les réglages du navigateur/appareil."
              : permission === "unsupported"
                ? "Cet appareil ne supporte pas les notifications système."
                : "Autorise les notifications pour être alerté hors de l'onglet."}
          </p>
          {permission !== "denied" && permission !== "unsupported" && (
            <button
              type="button"
              onClick={() => void request()}
              className="bg-warning-600 hover:bg-warning-700 rounded-control inline-flex h-9 items-center px-3 text-sm font-semibold text-white"
            >
              Autoriser
            </button>
          )}
        </div>
      )}

      {/* Test du son */}
      <div className="mt-3">
        <button
          type="button"
          onClick={testSound}
          disabled={testing}
          className="border-border hover:bg-surface-2 inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-medium disabled:opacity-60"
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Volume2 className="size-4" />
          )}
          Tester le son d&apos;alerte
        </button>
      </div>

      <p className="text-subtle mt-3 text-xs">
        Ces réglages sont propres à cet appareil. Sur un nouveau téléphone /
        tablette, reconfigure-les ici.
      </p>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="hover:bg-surface-2 -mx-2 flex cursor-pointer items-start justify-between gap-4 rounded-md px-2 py-3 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted mt-0.5 text-xs">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-success-500" : "bg-border-strong"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white transition-all",
            checked ? "left-5.5" : "left-0.5"
          )}
        />
      </button>
    </label>
  );
}
