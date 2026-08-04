"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Check,
  Loader2,
  MapPin,
  Navigation,
  Package,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  StickyNote,
  Wallet,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import {
  setCustomerBlockAction,
  setCustomerFeatureAction,
  setCustomerNoteAction,
} from "@/app/admin/(clients)/clients/actions";
import {
  CUSTOMER_FEATURES,
  CUSTOMER_FEATURE_LABEL,
  type CustomerDetail,
  type CustomerFeature,
  type CustomerLocation,
} from "@/lib/admin/customer-features";

// =============================================================================
// Fiche CLIENT (super-admin) — identité, activité, décisions.
//
// Chaque action a son PROPRE état de chargement (règle CLAUDE.md : jamais un
// état global qui fige la page), demande confirmation quand elle est lourde, et
// exige un motif à la suspension — un blocage sans raison n'est pas exploitable
// par le support.
// =============================================================================

const DATE = new Intl.DateTimeFormat("fr-DZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Algiers",
});
const fmt = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");

const LOCATION_META: Record<
  CustomerLocation["kind"],
  { label: string; className: string }
> = {
  device: { label: "Connexion", className: "bg-primary-100 text-primary-700" },
  address: { label: "Adresse", className: "bg-surface-2 text-muted" },
  delivery: {
    label: "Livraison",
    className: "bg-success-100 text-success-700",
  },
  ride: { label: "Course", className: "bg-accent-100 text-accent-700" },
};

export function CustomerDetailView({ detail }: { detail: CustomerDetail }) {
  const c = detail.customer;
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [blockPending, startBlock] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const blocked = new Set(detail.features.map((f) => f.feature));
  const last = detail.locations[0] ?? null;

  async function toggleBlock() {
    setError(null);
    if (c.is_blocked) {
      const ok = await confirm({
        title: "Réactiver ce compte ?",
        message: `${c.full_name} pourra de nouveau commander et réserver une course.`,
        confirmLabel: "Réactiver",
      });
      if (!ok) return;
      startBlock(async () => {
        const res = await setCustomerBlockAction(c.id, false);
        if (res.error) setError(res.error);
        else router.refresh();
      });
      return;
    }
    const reason = await prompt({
      title: "Suspendre ce compte",
      message:
        "Le client ne pourra plus passer de commande ni demander de course. Indique le motif — il sera conservé au journal.",
      placeholder: "Ex. fraude au cashback confirmée",
      confirmLabel: "Suspendre",
      multiline: true,
    });
    if (reason == null) return;
    if (!reason.trim()) {
      setError("Motif obligatoire pour suspendre un compte.");
      return;
    }
    startBlock(async () => {
      const res = await setCustomerBlockAction(c.id, true, reason);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <Link
        href="/admin/clients"
        prefetch
        className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm font-semibold"
      >
        <ArrowLeft className="size-4" />
        Annuaire clients
      </Link>

      {/* En-tête + décision de suspension (action destructive EN HAUT). */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
            {c.full_name || "Sans nom"}
            {c.is_blocked && (
              <span className="bg-danger-100 text-danger-700 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold">
                <Ban className="size-3.5" /> Suspendu
              </span>
            )}
            {!c.is_blocked && c.fraud_suspended && (
              <span className="bg-danger-100 text-danger-700 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold">
                <Ban className="size-3.5" /> Suspendu (anti-fraude)
              </span>
            )}
            {c.is_female_verified && (
              <span className="bg-accent-100 text-accent-700 rounded-full px-2.5 py-1 text-[12px] font-bold">
                Profil vérifié
              </span>
            )}
          </h2>
          <p className="text-muted mt-1 text-sm">
            {[c.phone, c.email, c.pay_handle && `@${c.pay_handle}`]
              .filter(Boolean)
              .join(" · ") || "Aucun contact"}
          </p>
          <p className="text-subtle mt-0.5 text-[12px]">
            Client depuis le {fmt(c.created_at)}
          </p>
        </div>

        <button
          type="button"
          onClick={toggleBlock}
          disabled={blockPending}
          className={cn(
            "inline-flex items-center gap-2 rounded-[12px] px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-60",
            c.is_blocked
              ? "bg-success-600 hover:bg-success-700 text-white"
              : "bg-danger-600 hover:bg-danger-700 text-white"
          )}
        >
          {blockPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : c.is_blocked ? (
            <ShieldCheck className="size-4" />
          ) : (
            <Ban className="size-4" />
          )}
          {c.is_blocked ? "Réactiver le compte" : "Suspendre le compte"}
        </button>
      </header>

      {error && (
        <p className="bg-danger-50 text-danger-700 mt-3 rounded-[12px] px-3 py-2 text-sm font-medium">
          {error}
        </p>
      )}

      {c.is_blocked && (
        <p className="border-danger-200 bg-danger-50 text-danger-800 mt-3 rounded-[12px] border p-3 text-sm">
          Suspendu le {fmt(c.blocked_at)}
          {c.blocked_by ? ` par ${c.blocked_by}` : ""}
          {c.blocked_reason ? ` — « ${c.blocked_reason} »` : ""}
        </p>
      )}

      {/* Sanction posée par le MODULE ANTI-FRAUDE (fraud_actions) : elle se
          lève là-bas, pas avec le bouton « Réactiver » ci-dessus — on pointe
          l'admin au bon endroit au lieu de le laisser chercher. */}
      {!c.is_blocked && c.fraud_suspended && (
        <p className="border-danger-200 bg-danger-50 text-danger-800 mt-3 rounded-[12px] border p-3 text-sm">
          Compte suspendu par le module Anti-fraude — le client voit « Compte
          suspendu » dans l&apos;app.{" "}
          <Link
            href={`/admin/anti-fraude/comptes/customer/${c.id}`}
            prefetch
            className="font-bold underline underline-offset-2"
          >
            Gérer la sanction →
          </Link>
        </p>
      )}

      {/* Activité */}
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Commandes"
          value={`${c.orders_count}`}
          hint={`${c.orders_completed} livrées`}
          Icon={Package}
        />
        <Stat
          label="Dépensé"
          value={formatDA(c.spend_da)}
          hint="commandes livrées"
          Icon={Wallet}
        />
        <Stat
          label="No-show"
          value={`${c.noshow_count}`}
          hint={c.cod_blocked ? "paiement livraison bloqué" : "aucun blocage"}
          Icon={ShieldOff}
        />
        <Stat
          label="Dernière position"
          value={last?.city ?? last?.label ?? "—"}
          hint={last ? fmt(last.seen_at) : "aucune trace"}
          Icon={Navigation}
        />
      </div>

      {/* Fonctionnalités par client */}
      <section className="border-border bg-surface mt-4 rounded-[16px] border p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <ShieldOff className="size-4" />
          Fonctionnalités de ce client
        </h3>
        <p className="text-muted mt-1 text-[13px]">
          Couper une fonctionnalité ici ferme l&apos;API pour ce client
          uniquement — les autres clients ne sont pas touchés.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {CUSTOMER_FEATURES.map((f) => (
            <FeatureRow
              key={f}
              customerId={c.id}
              feature={f}
              blocked={blocked.has(f)}
              reason={
                detail.features.find((x) => x.feature === f)?.reason ?? null
              }
            />
          ))}
        </ul>
      </section>

      {/* Positions */}
      <section className="border-border bg-surface mt-4 rounded-[16px] border p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <MapPin className="size-4" />
          Localisations connues
        </h3>
        <p className="text-muted mt-1 text-[13px]">
          Connexions (géo IP), adresses enregistrées, livraisons reçues et
          départs de course — de la plus récente à la plus ancienne.
        </p>
        {detail.locations.length === 0 ? (
          <p className="text-muted mt-3 text-sm">
            Aucune position enregistrée.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.locations.slice(0, 12).map((l, i) => (
              <li
                key={`${l.kind}-${i}`}
                className="border-border flex items-center gap-3 rounded-[12px] border p-2.5"
              >
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-bold",
                    LOCATION_META[l.kind].className
                  )}
                >
                  {LOCATION_META[l.kind].label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm font-medium">
                    {l.label}
                  </span>
                  <span className="text-muted block truncate text-[12px]">
                    {l.detail ?? "—"} · {fmt(l.seen_at)}
                  </span>
                </span>
                <a
                  href={`https://www.google.com/maps?q=${l.lat},${l.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-700 hover:bg-surface-2 shrink-0 rounded-[10px] px-2 py-1 text-[12px] font-semibold"
                >
                  Carte
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Appareils */}
      <section className="border-border bg-surface mt-4 rounded-[16px] border p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Smartphone className="size-4" />
          Appareils &amp; connexions
        </h3>
        {detail.devices.length === 0 ? (
          <p className="text-muted mt-3 text-sm">Aucune connexion tracée.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.devices.map((d) => (
              <li
                key={`${d.ip}-${d.last_seen_at}`}
                className="text-muted flex flex-wrap items-center justify-between gap-2 text-[13px]"
              >
                <span className="text-foreground font-medium">
                  {d.platform ?? "—"} · {d.ip}
                </span>
                <span>
                  {[d.city, d.country].filter(Boolean).join(", ") || "—"} ·{" "}
                  {fmt(d.last_seen_at)} · {d.hits} vues
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dernières commandes */}
      <section className="border-border bg-surface mt-4 rounded-[16px] border p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Package className="size-4" />
          Dernières commandes
        </h3>
        {detail.orders.length === 0 ? (
          <p className="text-muted mt-3 text-sm">Aucune commande.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.orders.map((o) => (
              <li
                key={o.id}
                className="border-border flex items-center gap-3 rounded-[12px] border p-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm font-medium">
                    {o.merchant_name ?? "Commerçant"}
                    {o.order_number ? ` · n°${o.order_number}` : ""}
                  </span>
                  <span className="text-muted block text-[12px]">
                    {fmt(o.created_at)} · {o.payment_method} ·{" "}
                    {o.delivery_mode ?? o.fulfillment_type ?? "retrait"}
                  </span>
                </span>
                <span className="text-foreground shrink-0 text-sm font-bold tabular-nums">
                  {formatDA(o.total_da)}
                </span>
                <span className="text-muted shrink-0 text-[12px]">
                  {o.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NotePanel customerId={c.id} note={c.admin_note} />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border-border bg-surface rounded-[14px] border p-3">
      <p className="text-muted flex items-center gap-1.5 text-[12px] font-semibold">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p className="text-foreground mt-1 truncate text-lg font-bold tabular-nums">
        {value}
      </p>
      {hint && <p className="text-subtle truncate text-[12px]">{hint}</p>}
    </div>
  );
}

/** Une ligne = une fonctionnalité, avec SON propre état de chargement. */
function FeatureRow({
  customerId,
  feature,
  blocked,
  reason,
}: {
  customerId: string;
  feature: CustomerFeature;
  blocked: boolean;
  reason: string | null;
}) {
  const router = useRouter();
  const prompt = usePrompt();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const meta = CUSTOMER_FEATURE_LABEL[feature];

  async function toggle() {
    setError(null);
    let motive: string | null = null;
    if (!blocked) {
      motive = await prompt({
        title: `Couper « ${meta.label} »`,
        message: meta.help,
        placeholder: "Motif (facultatif)",
      });
      if (motive == null) return; // annulé
    }
    start(async () => {
      const res = await setCustomerFeatureAction(
        customerId,
        feature,
        !blocked,
        motive ?? undefined
      );
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "border-border flex items-center gap-3 rounded-[12px] border p-3",
        blocked && "border-danger-200 bg-danger-50"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-sm font-semibold">
          {meta.label}
        </span>
        <span className="text-muted block text-[12px]">
          {blocked ? (reason ? `Coupée — ${reason}` : "Coupée") : meta.help}
        </span>
        {error && (
          <span className="text-danger-700 block text-[12px] font-medium">
            {error}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-bold transition-colors disabled:opacity-60",
          blocked
            ? "bg-success-600 hover:bg-success-700 text-white"
            : "border-border hover:bg-surface-2 text-muted border"
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : blocked ? (
          <Check className="size-3.5" />
        ) : (
          <ShieldOff className="size-3.5" />
        )}
        {blocked ? "Rétablir" : "Couper"}
      </button>
    </li>
  );
}

function NotePanel({
  customerId,
  note,
}: {
  customerId: string;
  note: string | null;
}) {
  const [value, setValue] = useState(note ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="border-border bg-surface mt-4 rounded-[16px] border p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <StickyNote className="size-4" />
        Note interne
      </h3>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        rows={3}
        placeholder="Contexte utile à l'équipe support (jamais visible du client)."
        className="border-border bg-surface text-foreground mt-2 w-full rounded-[12px] border p-3 text-sm"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await setCustomerNoteAction(customerId, value);
              if (res.error) setError(res.error);
              else setSaved(true);
            })
          }
          className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : saved ? (
            <Check className="size-3.5" />
          ) : null}
          {saved ? "Enregistrée" : "Enregistrer"}
        </button>
        {error && <span className="text-danger-700 text-[13px]">{error}</span>}
      </div>
    </section>
  );
}
