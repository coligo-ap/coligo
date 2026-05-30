"use client";

import { useTransition } from "react";
import { Bell, BellOff, Check, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useNotifyPermission } from "@/lib/hooks/use-notify-permission";
import { registerPushToken } from "@/lib/native/push";

/**
 * Contenu du panneau Notifications du livreur. Il n'y a pas d'« inbox » en base
 * (les notifications sont des push FCM) : on affiche donc l'état de la
 * permission + un bouton pour activer les push, puis un état vide. Réutilisé
 * par la cloche de l'accueil et par la section Notifications du profil.
 */
export function DriverNotificationsPanel() {
  const { permission, request } = useNotifyPermission();
  const [pending, start] = useTransition();

  const enable = () =>
    start(async () => {
      const next = await request();
      if (next === "granted") {
        const ok = await registerPushToken("courier");
        toast[ok ? "success" : "error"](
          ok
            ? "Notifications activées ⚡"
            : "Permission accordée, mais l'enregistrement push a échoué."
        );
      } else if (next === "denied") {
        toast.error(
          "Notifications bloquées. Autorise-les dans les réglages du téléphone."
        );
      }
    });

  return (
    <div className="space-y-3">
      {permission === "granted" ? (
        <div className="flex items-center gap-3 rounded-[12px] bg-[#e6f6ef] px-3.5 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#00a86b] text-white">
            <Check className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#0a0a0a]">
              Notifications activées
            </p>
            <p className="text-xs font-medium text-[#5a7a6c]">
              Tu seras prévenu de chaque nouvelle course Express.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] bg-[#f5f5f5] p-3.5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[#0a0a0a]">
              {permission === "denied" ? (
                <BellOff className="size-[18px]" />
              ) : (
                <Bell className="size-[18px]" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#0a0a0a]">
                {permission === "unsupported"
                  ? "Non disponible ici"
                  : permission === "denied"
                    ? "Notifications bloquées"
                    : "Active les notifications"}
              </p>
              <p className="text-xs font-medium text-[#757575]">
                {permission === "unsupported"
                  ? "Ce navigateur ne gère pas les notifications."
                  : permission === "denied"
                    ? "Réactive-les dans les réglages du téléphone → Coligo."
                    : "Pour ne rater aucune course Express qui t'est attribuée."}
              </p>
            </div>
          </div>
          {permission !== "unsupported" && permission !== "denied" && (
            <button
              type="button"
              onClick={enable}
              disabled={pending}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#0a0a0a] py-3 text-sm font-extrabold text-white active:scale-[0.99] disabled:opacity-60"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Activer les notifications
            </button>
          )}
        </div>
      )}

      {/* Pas d'inbox persistante : état vide. */}
      <div className="rounded-[12px] border border-dashed border-[#e0e0e0] px-4 py-8 text-center">
        <p className="text-sm font-semibold text-[#757575]">
          Aucune notification pour le moment
        </p>
        <p className="mt-1 text-xs font-medium text-[#9e9e9e]">
          Les nouvelles courses et annonces arrivent ici et en notification
          push.
        </p>
      </div>
    </div>
  );
}
