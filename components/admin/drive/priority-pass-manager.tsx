"use client";

import { useState, useTransition } from "react";
import { Crown, Save, Loader2, Zap, Bike, Car } from "lucide-react";
import {
  updatePriorityPass,
  type PriorityPass,
} from "@/app/admin/chauffeurs/(hub)/abonnements/actions";

// =============================================================================
// Carte « Pass Prioritaire » (super-admin). Le Pass Prioritaire est un abonnement
// UNIQUE commun aux livreurs ET aux chauffeurs : il achète la visibilité (coup
// d'avance au dispatch + badge), jamais une baisse de commission. Le super-admin
// pilote ici prix, promo 1er mois, fenêtre de priorité et disponibilité. Les
// valeurs sont imposées serveur — un partenaire ne peut jamais les modifier.
// =============================================================================
export function PriorityPassManager({ initial }: { initial: PriorityPass }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [monthly, setMonthly] = useState(initial.monthly_da);
  const [first, setFirst] = useState(initial.first_month_da);
  const [win, setWin] = useState(initial.window_sec);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const promoTooHigh = first > monthly;
  const totalSubs = initial.subs_drivers + initial.subs_chauffeurs;

  const save = () =>
    start(async () => {
      setMsg({});
      const res = await updatePriorityPass({
        enabled,
        monthly_da: monthly,
        first_month_da: first,
        window_sec: win,
      });
      setMsg(
        res.error
          ? { error: res.error }
          : { ok: "Pass Prioritaire enregistré ✓" }
      );
    });

  return (
    <section className="border-border overflow-hidden rounded-2xl border">
      <header className="flex items-center gap-2 bg-gradient-to-r from-[#5B2EFF] to-[#6C2BD9] px-4 py-3 text-white">
        <Crown className="size-5" />
        <div>
          <h2 className="font-extrabold">Pass Prioritaire</h2>
          <p className="text-[11px] text-white/80">
            Abonnement commun livreurs + chauffeurs — achète la visibilité (coup
            d’avance au dispatch + badge), pas une baisse de commission.
          </p>
        </div>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${
            enabled ? "bg-white/20" : "bg-black/25"
          }`}
        >
          {enabled ? "Proposé" : "Masqué"}
        </span>
      </header>

      <div className="bg-surface space-y-4 p-4">
        {/* Aperçu abonnés actifs. */}
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="Abonnés actifs"
            value={totalSubs.toLocaleString("fr-FR")}
          />
          <Stat
            label="Livreurs"
            value={initial.subs_drivers.toLocaleString("fr-FR")}
            icon={Bike}
          />
          <Stat
            label="Chauffeurs"
            value={initial.subs_chauffeurs.toLocaleString("fr-FR")}
            icon={Car}
          />
        </div>

        {/* Interrupteur de disponibilité (comme le is_active d'un plan). */}
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={
            "flex w-full items-center gap-2 rounded-[10px] border px-3 py-2.5 text-sm font-medium " +
            (enabled
              ? "border-primary-300 bg-primary-50 text-primary-700"
              : "border-border text-muted")
          }
        >
          <Zap className="size-4" />
          Proposé aux partenaires (livreurs + chauffeurs)
          <span className="ml-auto text-xs">{enabled ? "OUI" : "non"}</span>
        </button>
        {!enabled && (
          <p className="text-muted -mt-2 text-xs">
            Masqué : aucune nouvelle souscription possible (garde serveur). Les
            abonnements en cours restent valables jusqu’à leur échéance.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Prix mensuel (DA)">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={monthly}
              onChange={(e) => setMonthly(Math.max(0, +e.target.value))}
            />
          </Field>
          <Field
            label="Promo 1er mois (DA)"
            hint="Prix du tout premier mois (partenaire n’ayant jamais souscrit)."
          >
            <input
              type="number"
              min={0}
              className={inputCls + (promoTooHigh ? " border-danger-400" : "")}
              value={first}
              onChange={(e) => setFirst(Math.max(0, +e.target.value))}
            />
          </Field>
          <Field
            label="Fenêtre de priorité (s)"
            hint="Durée pendant laquelle une course est réservée aux Prioritaires. Passé ce délai, elle s’ouvre à tous (la priorité accélère, ne bloque jamais). 5 à 30 s."
          >
            <input
              type="number"
              min={5}
              max={30}
              className={inputCls}
              value={win}
              onChange={(e) =>
                setWin(Math.min(30, Math.max(5, +e.target.value)))
              }
            />
          </Field>
        </div>

        {promoTooHigh && (
          <p className="text-danger-600 text-sm font-medium">
            La promo du 1er mois ({first} DA) ne peut pas dépasser le prix
            mensuel ({monthly} DA).
          </p>
        )}
        {msg.error && (
          <p className="bg-danger-50 text-danger-700 rounded-[10px] px-3 py-2 text-sm font-medium">
            {msg.error}
          </p>
        )}
        {msg.ok && (
          <p className="bg-success-50 text-success-700 rounded-[10px] px-3 py-2 text-sm font-medium">
            {msg.ok}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={pending || promoTooHigh}
            className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Enregistrer le Pass Prioritaire
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------- primitives ---------- */
function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Bike;
}) {
  return (
    <div className="border-border bg-surface-2 rounded-[12px] border p-3">
      <p className="text-muted flex items-center gap-1 text-[11px] font-semibold">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </p>
      <p className="mt-0.5 text-lg font-extrabold">{value}</p>
    </div>
  );
}

const inputCls =
  "border-border bg-surface w-full rounded-[10px] border px-3 py-2 text-sm tabular-nums";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-muted mb-1 block text-xs font-semibold">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-muted mt-1 block text-[11px]">{hint}</span>
      )}
    </label>
  );
}
