"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Bell,
  CircleDollarSign,
  Globe,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import type { EffectiveRate, IntlSettings } from "@/lib/payments/intl";
import {
  notifyIntlWaitlist,
  refreshIntlRate,
  updateIntlSettings,
} from "@/app/admin/coligo-pay/international/actions";

// =============================================================================
// IntlPaymentsManager — pilotage complet des paiements en euros (diaspora) :
// kill-switch, pays autorisés, taux (auto parallèle − marge / manuel),
// plafonds, capacité live, sessions récentes, liste d'attente, audit.
// Le taux N'EST JAMAIS montré aux clients — cet écran est le seul endroit.
// =============================================================================

type SessionRow = {
  id: string;
  eur_cents: number;
  total_da: number;
  rate_da: number;
  rate_source: string;
  ip_country: string | null;
  status: string;
  created_at: string;
  order_id: string;
};

type Snapshot = {
  source: string;
  raw_rate_da: number | null;
  ok: boolean;
  note: string | null;
  fetched_at: string;
};

type AuditRow = { action: string; note: string | null; created_at: string };

function eur(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function dt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

const STATUS_TONE: Record<string, string> = {
  paid: "bg-success-100 text-success-700",
  created: "bg-primary-50 text-primary-700",
  failed: "bg-danger-50 text-danger-700",
  expired: "bg-surface-2 text-muted",
  refunded: "bg-warning-500/15 text-warning-600",
};

export function IntlPaymentsManager({
  settings,
  effectiveRate,
  keys,
  usage,
  sessions,
  snapshots,
  waitlistCount,
  audit,
}: {
  settings: IntlSettings;
  effectiveRate: EffectiveRate | null;
  keys: {
    test: boolean;
    live: boolean;
    webhook_test: boolean;
    webhook_live: boolean;
  };
  usage: { platform_day_cents: number; platform_month_cents: number };
  sessions: SessionRow[];
  snapshots: Snapshot[];
  waitlistCount: number;
  audit: AuditRow[];
}) {
  const [formState, formAction, formPending] = useActionState(
    updateIntlSettings,
    {}
  );
  const [rateMode, setRateMode] = useState(settings.rate_mode);
  const [refreshPending, startRefresh] = useTransition();
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [notifyPending, startNotify] = useTransition();
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);

  const dayPct = Math.min(
    100,
    Math.round(
      (usage.platform_day_cents / settings.platform_day_eur_cents) * 100
    )
  );
  const monthPct = Math.min(
    100,
    Math.round(
      (usage.platform_month_cents / settings.platform_month_eur_cents) * 100
    )
  );

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Globe className="text-primary-600 size-6" />
          Paiements internationaux (€)
        </h1>
        <p className="text-muted mt-1 text-sm">
          Carte Visa / Mastercard / Apple Pay via Stripe pour la diaspora. Le
          taux appliqué n&apos;est <strong>jamais montré aux clients</strong> —
          il ne vit qu&apos;ici.
        </p>
      </header>

      {/* ── Vue d'ensemble : taux effectif + capacité + waitlist ─────────── */}
      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="border-border bg-surface rounded-[16px] border p-4">
          <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
            Taux appliqué
          </p>
          <p className="text-foreground mt-1 text-xl font-extrabold tabular-nums">
            {effectiveRate ? `${effectiveRate.rate_da} DA / €` : "—"}
          </p>
          <p className="text-muted mt-0.5 text-[11px] font-medium">
            {effectiveRate
              ? effectiveRate.source === "manual"
                ? "Imposé manuellement"
                : `Auto : parallèle − ${settings.auto_margin_da} DA`
              : "Aucun taux résolvable — option coupée"}
          </p>
          <button
            type="button"
            disabled={refreshPending}
            onClick={() => {
              setRefreshMsg(null);
              startRefresh(async () => {
                const r = await refreshIntlRate();
                setRefreshMsg(
                  r.error
                    ? r.error
                    : `Taux rafraîchi : ${r.rate_da} DA / € (${r.source}).`
                );
              });
            }}
            className="border-border text-foreground mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-extrabold disabled:opacity-60"
          >
            {refreshPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Rafraîchir depuis le marché
          </button>
          {refreshMsg && (
            <p className="text-muted mt-2 text-[11px] font-medium">
              {refreshMsg}
            </p>
          )}
        </div>

        <div className="border-border bg-surface rounded-[16px] border p-4">
          <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
            Capacité plateforme
          </p>
          <div className="mt-2 space-y-2.5">
            {[
              {
                label: "Aujourd'hui",
                used: usage.platform_day_cents,
                max: settings.platform_day_eur_cents,
                pct: dayPct,
              },
              {
                label: "Ce mois-ci",
                used: usage.platform_month_cents,
                max: settings.platform_month_eur_cents,
                pct: monthPct,
              },
            ].map((row) => (
              <div key={row.label}>
                <div className="flex items-baseline justify-between">
                  <span className="text-foreground text-[12px] font-bold">
                    {row.label}
                  </span>
                  <span className="text-muted text-[11px] font-semibold tabular-nums">
                    {eur(row.used)} / {eur(row.max)}
                  </span>
                </div>
                <div className="bg-surface-2 mt-1 h-2 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      row.pct >= 100
                        ? "bg-danger-500"
                        : row.pct >= 80
                          ? "bg-warning-500"
                          : "bg-success-500"
                    )}
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-border bg-surface rounded-[16px] border p-4">
          <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
            Liste d&apos;attente
          </p>
          <p className="text-foreground mt-1 text-xl font-extrabold tabular-nums">
            {waitlistCount}
          </p>
          <p className="text-muted mt-0.5 text-[11px] font-medium">
            clients à prévenir à la réouverture
          </p>
          <button
            type="button"
            disabled={notifyPending || waitlistCount === 0}
            onClick={() => {
              setNotifyMsg(null);
              startNotify(async () => {
                const r = await notifyIntlWaitlist();
                setNotifyMsg(
                  r.error ? r.error : `${r.notified ?? 0} client(s) notifié(s).`
                );
              });
            }}
            className="border-border text-foreground mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-extrabold disabled:opacity-50"
          >
            {notifyPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Bell className="size-3.5" />
            )}
            Notifier la réouverture
          </button>
          {notifyMsg && (
            <p className="text-muted mt-2 text-[11px] font-medium">
              {notifyMsg}
            </p>
          )}
        </div>
      </section>

      {/* ── Réglages ─────────────────────────────────────────────────────── */}
      <form
        action={formAction}
        className="border-border bg-surface mb-5 rounded-[16px] border p-4"
      >
        <h2 className="text-foreground flex items-center gap-2 text-sm font-bold">
          <ShieldCheck className="text-primary-600 size-4" />
          Réglages
        </h2>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="border-border flex items-center justify-between gap-3 rounded-[12px] border px-3.5 py-3">
            <span>
              <span className="text-foreground block text-[13px] font-bold">
                Paiements € activés
              </span>
              <span className="text-muted block text-[11px] font-medium">
                Kill-switch global — coupe l&apos;option au checkout.
              </span>
            </span>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings.enabled}
              className="accent-primary-600 size-5"
            />
          </label>

          <label className="border-border flex items-center justify-between gap-3 rounded-[12px] border px-3.5 py-3">
            <span>
              <span className="text-foreground block text-[13px] font-bold">
                PayPal (via Stripe)
              </span>
              <span className="text-muted block text-[11px] font-medium">
                Nécessite un compte Stripe UE — laisser coupé sinon.
              </span>
            </span>
            <input
              type="checkbox"
              name="paypal_enabled"
              defaultChecked={settings.paypal_enabled}
              className="accent-primary-600 size-5"
            />
          </label>
        </div>

        <div className="mt-4">
          <label className="text-foreground block text-[13px] font-bold">
            Pays autorisés (codes ISO-2, ou * pour tous)
          </label>
          <input
            name="allowed_countries"
            defaultValue={settings.allowed_countries.join(", ")}
            placeholder="FR, BE, DE, ES…"
            className="border-border bg-surface text-foreground mt-1.5 h-11 w-full rounded-[12px] border px-3.5 text-[13.5px] font-semibold"
          />
          <p className="text-muted mt-1 text-[11px] font-medium">
            L&apos;option n&apos;apparaît qu&apos;aux clients dont l&apos;IP est
            dans ces pays. DZ est utile pour tes propres tests.
          </p>
        </div>

        {/* Taux */}
        <div className="border-border mt-4 rounded-[12px] border p-3.5">
          <p className="text-foreground text-[13px] font-bold">
            Taux de change (1 € = X DA)
          </p>
          <div className="mt-2 flex gap-2">
            {(
              [
                ["auto", "Auto : marché parallèle − marge"],
                ["manual", "Manuel : taux imposé"],
              ] as const
            ).map(([mode, label]) => (
              <label
                key={mode}
                className={cn(
                  "flex-1 cursor-pointer rounded-[10px] border-2 px-3 py-2 text-center text-[12px] font-extrabold transition",
                  rateMode === mode
                    ? "border-primary-600 bg-primary-50 text-primary-800"
                    : "border-border text-muted"
                )}
              >
                <input
                  type="radio"
                  name="rate_mode"
                  value={mode}
                  checked={rateMode === mode}
                  onChange={() => setRateMode(mode)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className={cn(rateMode !== "manual" && "opacity-40")}>
              <span className="text-muted block text-[11px] font-bold">
                Taux manuel (DA/€)
              </span>
              <input
                name="manual_rate_da"
                type="number"
                step="0.01"
                disabled={rateMode !== "manual"}
                defaultValue={settings.manual_rate_da ?? ""}
                className="border-border bg-surface text-foreground mt-1 h-10 w-full rounded-[10px] border px-3 text-[13px] font-semibold tabular-nums"
              />
            </label>
            <label className={cn(rateMode !== "auto" && "opacity-40")}>
              <span className="text-muted block text-[11px] font-bold">
                Marge auto (− DA)
              </span>
              <input
                name="auto_margin_da"
                type="number"
                step="0.01"
                disabled={rateMode !== "auto"}
                defaultValue={settings.auto_margin_da}
                className="border-border bg-surface text-foreground mt-1 h-10 w-full rounded-[10px] border px-3 text-[13px] font-semibold tabular-nums"
              />
            </label>
            <label>
              <span className="text-muted block text-[11px] font-bold">
                Plancher (DA/€)
              </span>
              <input
                name="rate_floor_da"
                type="number"
                step="0.01"
                defaultValue={settings.rate_floor_da}
                className="border-border bg-surface text-foreground mt-1 h-10 w-full rounded-[10px] border px-3 text-[13px] font-semibold tabular-nums"
              />
            </label>
            <label>
              <span className="text-muted block text-[11px] font-bold">
                Plafond (DA/€)
              </span>
              <input
                name="rate_ceiling_da"
                type="number"
                step="0.01"
                defaultValue={settings.rate_ceiling_da}
                className="border-border bg-surface text-foreground mt-1 h-10 w-full rounded-[10px] border px-3 text-[13px] font-semibold tabular-nums"
              />
            </label>
          </div>
          <p className="text-muted mt-2 text-[11px] font-medium">
            Auto = dernier taux observé du marché parallèle (snapshots
            ci-dessous) moins la marge, borné plancher/plafond. Exemple : marché
            à 270, marge 30 → 240 DA/€. Le manuel s&apos;applique immédiatement
            et ignore le marché.
          </p>
        </div>

        {/* Plafonds € */}
        <div className="border-border mt-4 rounded-[12px] border p-3.5">
          <p className="text-foreground text-[13px] font-bold">Plafonds (€)</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              [
                [
                  "per_order_min_eur",
                  "Min / commande",
                  settings.per_order_min_eur_cents,
                ],
                [
                  "per_order_max_eur",
                  "Max / commande",
                  settings.per_order_max_eur_cents,
                ],
                [
                  "per_user_day_eur",
                  "Client / jour",
                  settings.per_user_day_eur_cents,
                ],
                [
                  "per_user_month_eur",
                  "Client / mois",
                  settings.per_user_month_eur_cents,
                ],
                [
                  "platform_day_eur",
                  "Plateforme / jour",
                  settings.platform_day_eur_cents,
                ],
                [
                  "platform_month_eur",
                  "Plateforme / mois",
                  settings.platform_month_eur_cents,
                ],
              ] as const
            ).map(([name, label, cents]) => (
              <label key={name}>
                <span className="text-muted block text-[11px] font-bold">
                  {label}
                </span>
                <input
                  name={name}
                  type="number"
                  step="0.01"
                  defaultValue={(cents / 100).toFixed(2)}
                  className="border-border bg-surface text-foreground mt-1 h-10 w-full rounded-[10px] border px-3 text-[13px] font-semibold tabular-nums"
                />
              </label>
            ))}
          </div>
          <p className="text-muted mt-2 text-[11px] font-medium">
            Capacité atteinte → l&apos;option disparaît, les clients voient «
            momentanément indisponible » + « Me prévenir », et une alerte
            remonte dans le Centre d&apos;alertes.
          </p>
        </div>

        {formState.error && (
          <p className="border-danger-200 bg-danger-50 text-danger-800 mt-3 rounded-[10px] border px-3 py-2 text-sm">
            {formState.error}
          </p>
        )}
        {formState.ok && (
          <p className="mt-3 rounded-[10px] border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Réglages enregistrés — effet immédiat.
          </p>
        )}

        <button
          type="submit"
          disabled={formPending}
          className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[13.5px] font-extrabold text-white disabled:opacity-60"
        >
          {formPending && <Loader2 className="size-4 animate-spin" />}
          Enregistrer
        </button>
      </form>

      {/* ── Clés (présence seulement) ────────────────────────────────────── */}
      <section className="border-border bg-surface mb-5 rounded-[16px] border p-4">
        <h2 className="text-foreground text-sm font-bold">Environnement</h2>
        <div className="text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {(
            [
              ["Clé test", keys.test],
              ["Clé live", keys.live],
              ["Webhook test", keys.webhook_test],
              ["Webhook live", keys.webhook_live],
            ] as const
          ).map(([label, ok]) => (
            <span key={label}>
              {label} :{" "}
              <b className={ok ? "text-green-700" : "text-danger-600"}>
                {ok ? "configuré" : "absent"}
              </b>
            </span>
          ))}
        </div>
        <p className="text-muted mt-2 text-[11px] font-medium">
          La bascule TEST / LIVE se fait dans Plateforme → Contrôle des services
          (même fonctionnement que Chargily).
        </p>
      </section>

      {/* ── Sessions récentes ────────────────────────────────────────────── */}
      <section className="border-border bg-surface mb-5 rounded-[16px] border p-4">
        <h2 className="text-foreground flex items-center gap-2 text-sm font-bold">
          <CircleDollarSign className="text-primary-600 size-4" />
          Paiements récents
        </h2>
        {sessions.length === 0 ? (
          <p className="text-muted mt-2 text-[12.5px] font-medium">
            Aucune session pour l&apos;instant.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-start text-[12.5px]">
              <thead>
                <tr className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
                  <th className="py-1.5 pe-3 text-start">Date</th>
                  <th className="py-1.5 pe-3 text-start">Montant €</th>
                  <th className="py-1.5 pe-3 text-start">Équiv. DA</th>
                  <th className="py-1.5 pe-3 text-start">Taux</th>
                  <th className="py-1.5 pe-3 text-start">Pays</th>
                  <th className="py-1.5 text-start">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="text-muted py-2 pe-3 font-semibold tabular-nums">
                      {dt(s.created_at)}
                    </td>
                    <td className="text-foreground py-2 pe-3 font-extrabold tabular-nums">
                      {eur(s.eur_cents)}
                    </td>
                    <td className="text-foreground py-2 pe-3 font-semibold tabular-nums">
                      {formatDA(s.total_da)}
                    </td>
                    <td className="text-muted py-2 pe-3 font-semibold tabular-nums">
                      {s.rate_da} (
                      {s.rate_source === "manual" ? "man." : "auto"})
                    </td>
                    <td className="text-muted py-2 pe-3 font-semibold">
                      {s.ip_country ?? "—"}
                    </td>
                    <td className="py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10.5px] font-extrabold",
                          STATUS_TONE[s.status] ?? "bg-surface-2 text-muted"
                        )}
                      >
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Snapshots du taux + audit ────────────────────────────────────── */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="border-border bg-surface rounded-[16px] border p-4">
          <h2 className="text-foreground text-sm font-bold">
            Relevés du marché parallèle
          </h2>
          <ul className="divide-border mt-2 divide-y">
            {snapshots.length === 0 && (
              <li className="text-muted py-2 text-[12px] font-medium">
                Aucun relevé — le premier paiement (ou « Rafraîchir ») en créera
                un.
              </li>
            )}
            {snapshots.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-muted text-[11.5px] font-semibold tabular-nums">
                  {dt(s.fetched_at)}
                </span>
                {s.ok ? (
                  <span className="text-foreground text-[12.5px] font-extrabold tabular-nums">
                    {s.raw_rate_da} DA/€
                  </span>
                ) : (
                  <span className="text-danger-600 max-w-[55%] truncate text-[11.5px] font-bold">
                    échec — {s.note ?? "?"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="border-border bg-surface rounded-[16px] border p-4">
          <h2 className="text-foreground text-sm font-bold">
            Journal d&apos;audit
          </h2>
          <ul className="divide-border mt-2 divide-y">
            {audit.length === 0 && (
              <li className="text-muted py-2 text-[12px] font-medium">
                Aucun événement.
              </li>
            )}
            {audit.map((a, i) => (
              <li key={i} className="py-2">
                <p className="text-foreground text-[12px] font-extrabold">
                  {a.action}
                  <span className="text-muted ms-2 text-[11px] font-semibold tabular-nums">
                    {dt(a.created_at)}
                  </span>
                </p>
                {a.note && (
                  <p className="text-muted mt-0.5 text-[11.5px] leading-snug font-medium">
                    {a.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
