"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { InfoHint } from "@/components/ui/info-hint";
import { simulateMargins } from "@/lib/drive/margins";
import { updateDriveConfig, type DriveConfig } from "@/app/admin/drive/actions";

/**
 * Config Drive (super-admin) — AUCUNE valeur financière en dur dans le code :
 * tout se règle ici. Le SIMULATEUR DE MARGE (bas de page) recalcule la marge
 * plateforme par plan en direct et BLOQUE l'enregistrement si une combinaison
 * est perdante (garde-fou analyse finance).
 */
export function DriveConfigForm({ initial }: { initial: DriveConfig }) {
  const [cfg, setCfg] = useState<DriveConfig>(initial);
  const [basket, setBasket] = useState(300);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const sims = useMemo(
    () => simulateMargins({ ...cfg, basket }),
    [cfg, basket]
  );
  const losing = sims.some((s) => s.cash < 0 || s.online < 0);

  const set = <K extends keyof DriveConfig>(k: K, v: DriveConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));
  const setG = (
    g: "classic" | "confort" | "moto",
    k: "base" | "per_km" | "min",
    v: number
  ) =>
    setCfg((c) => ({
      ...c,
      pricing: { ...c.pricing, [g]: { ...c.pricing[g], [k]: v } },
    }));

  const save = () =>
    start(async () => {
      setMsg({});
      const res = await updateDriveConfig(cfg);
      setMsg(
        res.error ? { error: res.error } : { ok: "Configuration enregistrée ✓" }
      );
    });

  return (
    <div className="space-y-5">
      {/* Barème par gamme */}
      <Section title="Barème du prix recommandé (par gamme)">
        <div className="grid gap-3 sm:grid-cols-3">
          {(["classic", "confort", "moto"] as const).map((g) => (
            <div key={g} className="border-border rounded-[12px] border p-3">
              <p className="mb-2 text-sm font-bold capitalize">{g}</p>
              <Num
                label="Base (DA)"
                value={cfg.pricing[g].base}
                onChange={(v) => setG(g, "base", v)}
              />
              <Num
                label="DA / km"
                value={cfg.pricing[g].per_km}
                onChange={(v) => setG(g, "per_km", v)}
              />
              <Num
                label="Plancher (DA)"
                value={cfg.pricing[g].min}
                onChange={(v) => setG(g, "min", v)}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Num
            label="Coef nuit (≤ 0,20 · jamais affiché)"
            step={0.01}
            value={cfg.night_coef}
            onChange={(v) => set("night_coef", v)}
            hint="Majoration nocturne du prix recommandé (jamais montrée au client). 0,20 = +20 % la nuit."
            example="0,15 → une course recommandée à 200 DA passe à ~230 DA pendant la nuit."
          />
          <Num
            label="Début nuit (h)"
            value={cfg.night_start_h}
            onChange={(v) => set("night_start_h", v)}
          />
          <Num
            label="Fin nuit (h)"
            value={cfg.night_end_h}
            onChange={(v) => set("night_end_h", v)}
          />
          <Num
            label="Plancher (× recommandé jour)"
            step={0.05}
            value={cfg.floor_rate}
            onChange={(v) => set("floor_rate", v)}
            hint="Prix minimum accepté, en fraction du prix recommandé de jour. Empêche des offres trop basses."
            example="0,80 → si le recommandé est 200 DA, le client ne peut pas proposer moins de 160 DA."
          />
        </div>
      </Section>

      {/* Prix / boost / cashback */}
      <Section title="Offre client, boost, cashback">
        <div className="grid gap-3 sm:grid-cols-4">
          <Num
            label="Pas du prix (DA)"
            value={cfg.price_step_da}
            onChange={(v) => set("price_step_da", v)}
            hint="Incrément des boutons + / − quand le client ajuste son offre de prix."
            example="20 → le prix monte ou descend de 20 DA à chaque appui."
          />
          <Num
            label="Boost min (DA)"
            value={cfg.boost_min_da}
            onChange={(v) => set("boost_min_da", v)}
            hint="Le boost est un supplément que le client ajoute pour attirer un chauffeur plus vite. Ceci en est le minimum."
            example="10 → impossible d'ajouter un boost inférieur à 10 DA."
          />
          <Num
            label="Pas du boost (DA)"
            value={cfg.boost_step_da}
            onChange={(v) => set("boost_step_da", v)}
            hint="Incrément des boutons + / − du boost."
            example="5 → le boost s'ajuste par tranches de 5 DA."
          />
          <Num
            label="Boost défaut (× trajet)"
            step={0.01}
            value={cfg.boost_default_rate}
            onChange={(v) => set("boost_default_rate", v)}
            hint="Boost proposé par défaut, en fraction du prix de la course."
            example="0,10 → pour une course à 300 DA, le boost suggéré est 30 DA."
          />
          <Num
            label="Cashback (× prix, financé par la commission)"
            step={0.005}
            value={cfg.cashback_rate}
            onChange={(v) => set("cashback_rate", v)}
            hint="Part du prix reversée au client en crédit Coligo Pay, prise SUR la commission plateforme (pas un coût en plus)."
            example="0,02 → sur une course à 300 DA, le client gagne 6 DA de cashback."
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={cfg.female_filter_enabled}
            onChange={(e) => set("female_filter_enabled", e.target.checked)}
            className="size-4"
          />
          Filtre « Femme au volant » activé (flag FEMALE_DRIVER_FILTER)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={cfg.newcustomer_enabled}
            onChange={(e) => set("newcustomer_enabled", e.target.checked)}
            className="size-4"
          />
          Remise « Bienvenue » 1ʳᵉ course (ancrage — décocher = prix normal,
          sans prix gonflé)
        </label>
        {cfg.newcustomer_enabled && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Num
              label="Bienvenue — remise affichée (×)"
              step={0.05}
              value={cfg.newcustomer_rate}
              onChange={(v) => set("newcustomer_rate", v)}
              hint="Remise COSMÉTIQUE : on affiche un prix gonflé barré et le code BIENVENUE le ramène au prix réel. Le chauffeur touche le prix réel, coût plateforme = 0."
              example="0,30 → prix réel 500 affiché comme 715 barré → « −30 % » → payé 500."
            />
          </div>
        )}
        <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={cfg.scheduled_enabled}
            onChange={(e) => set("scheduled_enabled", e.target.checked)}
            className="size-4"
          />
          Réservation programmée activée (masquée côté client tant que décochée)
        </label>
      </Section>

      {/* Plans */}
      <Section title="Abonnements chauffeur (commission par plan)">
        <label className="mb-3 flex items-start gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={cfg.paid_plans_enabled}
            onChange={(e) => set("paid_plans_enabled", e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            Abonnements payants Pro / Premium proposés aux chauffeurs
            <span className="text-muted block text-xs font-normal">
              Décoché au lancement : le chauffeur ne voit que le plan Gratuit (0
              % de commission). L&apos;abonnement Prioritaire (visibilité) reste
              disponible. Garde serveur : tant que c&apos;est décoché, toute
              souscription Pro/Premium est refusée même via un appel forgé.
            </span>
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-5">
          <Num
            label="Gratuit — commission"
            step={0.005}
            value={cfg.free_rate}
            onChange={(v) => set("free_rate", v)}
            hint="Commission plateforme du plan gratuit, en fraction du prix (0,12 = 12 % prélevés sur chaque course). Idem pour Pro/Premium."
            example="0,12 → sur une course à 300 DA, la plateforme prend 36 DA."
          />
          <Num
            label="Pro — DA/mois"
            value={cfg.plan_pro_fee_da}
            onChange={(v) => set("plan_pro_fee_da", v)}
          />
          <Num
            label="Pro — commission"
            step={0.005}
            value={cfg.plan_pro_rate}
            onChange={(v) => set("plan_pro_rate", v)}
          />
          <Num
            label="Premium — DA/mois"
            value={cfg.plan_premium_fee_da}
            onChange={(v) => set("plan_premium_fee_da", v)}
          />
          <Num
            label="Facteur 1 semaine"
            step={0.05}
            value={cfg.sub_week_factor}
            onChange={(v) => set("sub_week_factor", v)}
            hint="Tarif 1 semaine = tarif mensuel × ce facteur."
            example="0,35 → Pro à 2000 DA/mois ⇒ 1 semaine = 700 DA."
          />
          <Num
            label="Facteur 2 semaines"
            step={0.05}
            value={cfg.sub_2week_factor}
            onChange={(v) => set("sub_2week_factor", v)}
            hint="Tarif 2 semaines = tarif mensuel × ce facteur."
            example="0,60 → Pro à 2000 DA/mois ⇒ 2 semaines = 1200 DA."
          />
          <Num
            label="Jours de grâce (renouvellement)"
            value={cfg.sub_grace_days}
            onChange={(v) => set("sub_grace_days", v)}
            hint="Délai toléré après l'échéance d'un abonnement avant de repasser le chauffeur au plan gratuit."
            example="3 → un chauffeur Pro non renouvelé garde son tarif Pro encore 3 jours."
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Txt
            label="CCP plateforme (numéro)"
            value={cfg.ccp_number}
            onChange={(v) => set("ccp_number", v)}
          />
          <Txt
            label="Clé CCP"
            value={cfg.ccp_key}
            onChange={(v) => set("ccp_key", v)}
          />
          <Txt
            label="Titulaire"
            value={cfg.ccp_name}
            onChange={(v) => set("ccp_name", v)}
          />
        </div>
        <p className="text-muted mt-1 text-xs">
          ⚠️ Le CCP affiché aux chauffeurs est un PLACEHOLDER tant que le numéro
          réel n&apos;a pas été saisi ici.
        </p>
      </Section>

      {/* Seuils de gel */}
      <Section title="Gel automatique (seuils)">
        <div className="grid gap-3 sm:grid-cols-5">
          <Num
            label="Dette max (DA)"
            value={cfg.freeze_debt_da}
            onChange={(v) => set("freeze_debt_da", v)}
            hint="Dette (commissions/avances dues) au-delà de laquelle le chauffeur ne peut plus prendre de course."
            example="2000 → à 2000 DA de dette, le chauffeur est bloqué jusqu'au règlement."
          />
          <Num
            label="Taux annulation max"
            step={0.01}
            value={cfg.freeze_cancel_rate}
            onChange={(v) => set("freeze_cancel_rate", v)}
            hint="Au-delà de ce taux d'annulations, le chauffeur est gelé automatiquement."
            example="0,30 → plus de 30 % de courses annulées sur la fenêtre → gel."
          />
          <Num
            label="… sur N dernières courses"
            value={cfg.freeze_cancel_window}
            onChange={(v) => set("freeze_cancel_window", v)}
            hint="Fenêtre de calcul du taux d'annulation ci-contre."
            example="20 → on regarde les 20 dernières courses."
          />
          <Num
            label="Note minimale"
            step={0.1}
            value={cfg.freeze_min_rating}
            onChange={(v) => set("freeze_min_rating", v)}
            hint="En dessous de cette note moyenne, le chauffeur est gelé."
            example="3,5 → un chauffeur sous 3,5 / 5 est gelé."
          />
          <Num
            label="… sur N derniers avis"
            value={cfg.freeze_rating_window}
            onChange={(v) => set("freeze_rating_window", v)}
          />
        </div>
      </Section>

      {/* Divers */}
      <Section title="Diffusion & sécurité">
        <div className="grid gap-3 sm:grid-cols-4">
          <Num
            label="« Je rentre chez moi » / jour"
            value={cfg.home_dir_max_per_day}
            onChange={(v) => set("home_dir_max_per_day", v)}
            hint="Nombre de fois par jour où un chauffeur peut activer le mode « trajet retour » (il ne reçoit que les courses qui vont vers chez lui)."
            example="2 → 2 trajets retour maximum par jour et par chauffeur."
          />
          <Num
            label="TTL demande (min)"
            value={cfg.request_ttl_min}
            onChange={(v) => set("request_ttl_min", v)}
            hint="« TTL » = durée de vie. Temps avant qu'une demande de course expire si aucun chauffeur n'accepte."
            example="10 → la recherche s'arrête automatiquement au bout de 10 min."
          />
          <Num
            label="TTL proposition (min)"
            value={cfg.offer_ttl_min}
            onChange={(v) => set("offer_ttl_min", v)}
            hint="Durée pendant laquelle l'offre de prix d'un chauffeur reste valable côté client."
            example="3 → une offre disparaît si le client ne répond pas en 3 min."
          />
          <Num
            label="Rayon back-to-back (km)"
            step={0.1}
            value={cfg.b2b_radius_km}
            onChange={(v) => set("b2b_radius_km", v)}
            hint="« Back-to-back » = enchaîner deux courses. Distance max pour proposer la course suivante à un chauffeur juste avant qu'il termine."
            example="2 → on enchaîne si la prochaine prise en charge est à moins de 2 km de l'arrivée."
          />
          <Num
            label="Attente client absent (min)"
            value={cfg.pickup_wait_min}
            onChange={(v) => set("pickup_wait_min", v)}
          />
          <Num
            label="Écart itinéraire anormal (km)"
            step={0.1}
            value={cfg.deviation_km}
            onChange={(v) => set("deviation_km", v)}
            hint="Sécurité : si la course s'écarte de l'itinéraire prévu de plus de cette distance (pendant la durée ci-contre), une alerte est déclenchée."
            example="1,2 km pendant 2 min → alerte si le trajet dévie autant sans raison."
          />
          <Num
            label="… pendant (min)"
            value={cfg.deviation_min}
            onChange={(v) => set("deviation_min", v)}
          />
        </div>
      </Section>

      {/* Simulateur de marge BLOQUANT */}
      <Section title="Simulateur de marge (bloquant)">
        <div className="mb-2 flex items-end gap-3">
          <Num label="Course type (DA)" value={basket} onChange={setBasket} />
        </div>
        <table className="w-full max-w-md text-sm">
          <thead className="text-muted text-xs uppercase">
            <tr>
              <th className="py-1 text-left">Plan</th>
              <th className="py-1 text-right">Marge espèces</th>
              <th className="py-1 text-right">Marge en ligne</th>
            </tr>
          </thead>
          <tbody>
            {sims.map((s) => (
              <tr key={s.plan} className="border-border border-t">
                <td className="py-1.5 font-semibold">{s.plan}</td>
                <td
                  className={`py-1.5 text-right tabular-nums ${s.cash < 0 ? "text-danger-600 font-bold" : ""}`}
                >
                  {s.cash} DA
                </td>
                <td
                  className={`py-1.5 text-right tabular-nums ${s.online < 0 ? "text-danger-600 font-bold" : ""}`}
                >
                  {s.online} DA
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted mt-2 text-xs">
          Marge = commission − cashback (plafonné par la commission) − frais
          Chargily (en ligne). Le boost est 100 % chauffeur (hors marge). Une
          config à marge négative est{" "}
          <strong>refusée à l&apos;enregistrement</strong>.
        </p>
        {losing && (
          <p className="text-danger-600 mt-2 text-sm font-bold">
            ⚠️ Config perdante détectée — corrigez avant d&apos;enregistrer.
          </p>
        )}
      </Section>

      {msg.error && (
        <p className="text-danger-700 bg-danger-50 rounded-[10px] px-3 py-2 text-sm font-semibold">
          {msg.error}
        </p>
      )}
      {msg.ok && (
        <p className="text-success-700 bg-success-50 rounded-[10px] px-3 py-2 text-sm font-semibold">
          {msg.ok}
        </p>
      )}
      <button
        type="button"
        disabled={pending || losing}
        onClick={save}
        className="bg-primary-700 inline-flex h-11 items-center gap-2 rounded-[12px] px-5 text-sm font-bold text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Save className="size-4" />
        )}
        Enregistrer la configuration
      </button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border-border rounded-[14px] border p-4">
      <h2 className="mb-3 text-sm font-bold uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 1,
  hint,
  example,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  /** Aide « i » (explication courte) affichée à côté du libellé. */
  hint?: string;
  /** Exemple concret pour l'aide. */
  example?: string;
}) {
  return (
    <label className="block text-xs font-semibold">
      <span className="text-muted mb-1 flex items-center gap-1">
        {label}
        {hint && <InfoHint title={label} text={hint} example={example} />}
      </span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border-border w-full rounded-[10px] border px-2.5 py-2 text-sm tabular-nums"
      />
    </label>
  );
}

function Txt({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs font-semibold">
      <span className="text-muted mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-border w-full rounded-[10px] border px-2.5 py-2 text-sm"
      />
    </label>
  );
}
