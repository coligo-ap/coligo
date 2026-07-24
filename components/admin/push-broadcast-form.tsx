"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import {
  sendBroadcastPush,
  type BroadcastState,
} from "@/app/admin/notifications/actions";
import { cn } from "@/lib/utils";

const ROLE_OPTIONS = [
  { key: "customer", label: "Clients" },
  { key: "courier", label: "Livreurs" },
  { key: "merchant", label: "Commerçants" },
  { key: "chauffeur", label: "Chauffeurs" },
] as const;

/**
 * Formulaire de diffusion push (super-admin) : cases par type d'utilisateur
 * (+ « tout cocher » via les cases elles-mêmes), titre, message, lien interne
 * optionnel. Résultat affiché INLINE sous le bouton (pas de toast).
 */
export function PushBroadcastForm({
  counts,
}: {
  counts: Record<string, number>;
}) {
  const [state, formAction, pending] = useActionState<BroadcastState, FormData>(
    sendBroadcastPush,
    {}
  );

  return (
    <form
      action={formAction}
      className="border-border space-y-5 rounded-[14px] border bg-white p-5"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Destinataires</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ROLE_OPTIONS.map((r) => (
            <label
              key={r.key}
              className="border-border hover:bg-surface-2 has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50 flex cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors"
            >
              <input
                type="checkbox"
                name={`role_${r.key}`}
                className="accent-primary-600 size-4"
              />
              <span className="min-w-0">
                {r.label}
                <span className="text-muted block text-xs font-normal">
                  {counts[r.key] ?? 0} appareil
                  {(counts[r.key] ?? 0) > 1 ? "s" : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="push-wilaya"
          className="mb-1 block text-sm font-semibold"
        >
          Zone marketing — wilaya{" "}
          <span className="text-muted font-normal">(optionnel)</span>
        </label>
        <input
          id="push-wilaya"
          name="wilaya"
          inputMode="numeric"
          placeholder="Ex. : 16 (Alger), 06 (Béjaïa)"
          className="border-border focus:border-primary-400 w-full rounded-[10px] border px-3 py-2 text-sm outline-none"
        />
        <p className="text-muted mt-1 text-xs">
          Envoie aux appareils abonnés à cette wilaya (promo de zone),{" "}
          <b>même déconnectés</b>. Laisse vide pour n&apos;envoyer qu&apos;aux
          types cochés ci-dessus.
        </p>
      </div>

      <div>
        <label
          htmlFor="push-title"
          className="mb-1 block text-sm font-semibold"
        >
          Titre
        </label>
        <input
          id="push-title"
          name="title"
          required
          maxLength={80}
          placeholder="Ex. : Nouveautés Coligo 🎉"
          className="border-border focus:border-primary-400 w-full rounded-[10px] border px-3 py-2 text-sm outline-none"
        />
      </div>

      <div>
        <label htmlFor="push-body" className="mb-1 block text-sm font-semibold">
          Message
        </label>
        <textarea
          id="push-body"
          name="body"
          required
          maxLength={300}
          rows={3}
          placeholder="Le texte de la notification…"
          className="border-border focus:border-primary-400 w-full resize-y rounded-[10px] border px-3 py-2 text-sm outline-none"
        />
      </div>

      <div>
        <label
          htmlFor="push-route"
          className="mb-1 block text-sm font-semibold"
        >
          Lien à l&apos;ouverture{" "}
          <span className="text-muted font-normal">(optionnel)</span>
        </label>
        <input
          id="push-route"
          name="route"
          placeholder="/promos, /driver, /commande/…"
          className="border-border focus:border-primary-400 w-full rounded-[10px] border px-3 py-2 text-sm outline-none"
        />
        <p className="text-muted mt-1 text-xs">
          Chemin interne ouvert quand l&apos;utilisateur touche la notification
          (vide = accueil).
        </p>
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold text-white transition-colors",
            pending && "cursor-not-allowed opacity-60"
          )}
        >
          <Send className="size-4" />
          {pending ? "Envoi en cours…" : "Envoyer la notification"}
        </button>

        {state.error && (
          <p className="text-danger-600 mt-2 text-sm font-medium">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="text-success-600 mt-2 text-sm font-medium">
            {state.zone &&
              `Promo envoyée à la wilaya ${state.zone} (appareils abonnés). `}
            {(state.devices ?? 0) > 0 &&
              `Envoyée à ${state.sent}/${state.devices} appareil${(state.devices ?? 0) > 1 ? "s" : ""}.`}
          </p>
        )}
      </div>
    </form>
  );
}
