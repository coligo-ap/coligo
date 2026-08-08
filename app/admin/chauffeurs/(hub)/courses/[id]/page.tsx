import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  Car,
  CreditCard,
  History,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import { getAdminRideDetail } from "@/lib/data/admin-rides";
import { RIDE_STATUS_META } from "@/components/admin/drive/rides-explorer";
import { RideAdminPanel } from "@/components/admin/drive/ride-admin-panel";

export const dynamic = "force-dynamic";

/**
 * Fiche COURSE Drive super-admin (parité fiche commande) : acteurs, trajet,
 * argent (prix/boost/séquestre/commission/net/cashback/cash dû/remboursé),
 * historique fusionné (jalons + ride_events + audit admin avant/après + IP),
 * grand livre chauffeur, et toutes les actions de gestion.
 */

const dt = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("fr-DZ", {
        timeZone: "Africa/Algiers",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

const ADMIN_ACTION_LABEL: Record<string, string> = {
  cancel_ride: "Course annulée par la plateforme",
  complete_ride: "Course clôturée par la plateforme",
  refund_ride_customer: "Client remboursé (Coligo Pay)",
  compensate_chauffeur: "Chauffeur indemnisé",
};

function jsonSummary(v: Record<string, unknown> | null): string | null {
  if (!v) return null;
  const parts = Object.entries(v)
    .filter(([, val]) => val !== null && val !== undefined)
    .map(([k, val]) => `${k}: ${String(val)}`);
  return parts.length ? parts.join(" · ") : null;
}

export default async function AdminRideDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAdminRideDetail(id);
  if (!detail) notFound();
  const { ride: r, customer, chauffeur, events, ledger, audit } = detail;

  const meta = RIDE_STATUS_META[r.status];
  const priceDa = Math.max(
    0,
    r.agreed_price_da ?? (r.proposed_price_da ?? 0) + (r.boost_amount_da ?? 0)
  );
  const refundRemaining =
    r.status === "completed"
      ? Math.max(0, priceDa - (r.admin_refunded_da ?? 0))
      : 0;

  // Chronologie fusionnée : jalons + événements + audit admin.
  type Entry = {
    key: string;
    at: string;
    title: string;
    detail?: string | null;
    admin?: string | null;
    ip?: string | null;
    kind: "milestone" | "event" | "admin";
  };
  const entries: Entry[] = [];
  const milestone = (at: string | null, title: string) => {
    if (at) entries.push({ key: `m-${title}`, at, title, kind: "milestone" });
  };
  milestone(r.created_at, "Demande créée");
  milestone(r.scheduled_at, "Programmée pour");
  milestone(r.online_paid_at, "Payée en ligne");
  milestone(r.accepted_at, "Acceptée par le chauffeur");
  milestone(r.arrived_at, "Chauffeur arrivé");
  milestone(r.started_at, "Course démarrée");
  milestone(r.completed_at, "Terminée");
  milestone(r.cancelled_at, "Annulée");
  for (const e of events) {
    entries.push({
      key: `e-${e.id}`,
      at: e.created_at,
      title:
        e.from_status === e.to_status
          ? "Événement"
          : `${e.from_status ?? "—"} → ${e.to_status ?? "—"}`,
      detail: e.note,
      kind: "event",
    });
  }
  for (const a of audit) {
    const values = [
      a.old_value ? `avant — ${jsonSummary(a.old_value)}` : null,
      a.new_value ? `après — ${jsonSummary(a.new_value)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    entries.push({
      key: `a-${a.id}`,
      at: a.created_at,
      title: ADMIN_ACTION_LABEL[a.action] ?? a.action,
      detail: [a.note, values || null].filter(Boolean).join(" · ") || null,
      admin: a.admin_email,
      ip: a.ip,
      kind: "admin",
    });
  }
  entries.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());

  return (
    <div>
      <Link
        href="/admin/chauffeurs/courses"
        className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4" />
        Courses
      </Link>

      {/* ---- En-tête ---- */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-bold tracking-tight">
              Course {r.id.slice(0, 8).toUpperCase()}
            </h1>
            <Badge tone={meta?.tone ?? "neutral"}>
              {meta?.label ?? r.status}
            </Badge>
            {r.gamme && <Badge tone="neutral">{r.gamme}</Badge>}
            {r.is_interwilaya && (
              <Badge tone="primary">
                Inter-wilayas
                {r.pickup_wilaya && r.dest_wilaya
                  ? ` ${r.pickup_wilaya} → ${r.dest_wilaya}`
                  : ""}
              </Badge>
            )}
            {r.female_only && <Badge tone="primary">Femmes uniquement</Badge>}
            {(r.admin_refunded_da ?? 0) > 0 && (
              <Badge tone="primary">Remboursée partiellement</Badge>
            )}
          </div>
          <p className="text-muted mt-1 text-sm">
            Créée le {dt(r.created_at)}
            {r.cancelled_by ? ` · annulée par : ${r.cancelled_by}` : ""}
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums">{formatDA(priceDa)}</p>
      </header>

      {/* ---- Acteurs + trajet ---- */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <section className="border-border bg-surface rounded-card-lg border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <User className="size-3.5" />
            Client
          </h2>
          <p className="mt-2 text-sm font-bold">{customer?.full_name ?? "—"}</p>
          {customer?.phone && (
            <p className="text-muted mt-0.5 flex items-center gap-1 text-xs">
              <Phone className="size-3" />
              {customer.phone}
            </p>
          )}
          {r.proxy_name && (
            <p className="text-muted mt-1 text-xs">
              Pour un proche : {r.proxy_name}
              {r.proxy_phone ? ` · ${r.proxy_phone}` : ""}
            </p>
          )}
          {r.client_rating != null && (
            <p className="text-subtle mt-1 text-xs">
              Note laissée au chauffeur : {r.client_rating}/5
            </p>
          )}
        </section>

        <section className="border-border bg-surface rounded-card-lg border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <Car className="size-3.5" />
            Chauffeur
          </h2>
          {chauffeur ? (
            <>
              <p className="mt-2 text-sm font-bold">{chauffeur.full_name}</p>
              {chauffeur.phone && (
                <p className="text-muted mt-0.5 flex items-center gap-1 text-xs">
                  <Phone className="size-3" />
                  {chauffeur.phone}
                </p>
              )}
              {chauffeur.vehicle_label && (
                <p className="text-subtle mt-0.5 text-xs">
                  {chauffeur.vehicle_label}
                </p>
              )}
              <Link
                href={`/admin/chauffeurs/${chauffeur.id}`}
                className="text-primary-700 mt-1 inline-block text-xs font-semibold hover:underline"
              >
                Sa fiche →
              </Link>
            </>
          ) : (
            <p className="text-muted mt-2 text-sm">Aucun chauffeur attribué.</p>
          )}
        </section>

        <section className="border-border bg-surface rounded-card-lg border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <MapPin className="size-3.5" />
            Trajet
          </h2>
          <p className="mt-2 text-xs">
            <span className="font-semibold">Départ :</span>{" "}
            {r.pickup_text ?? "—"}
          </p>
          <p className="mt-1 text-xs">
            <span className="font-semibold">Arrivée :</span>{" "}
            {r.dest_text ?? "—"}
          </p>
          {r.distance_km != null && (
            <p className="text-subtle mt-1 text-xs">
              ≈ {Number(r.distance_km).toFixed(1)} km
            </p>
          )}
        </section>
      </div>

      {/* ---- Paiement ---- */}
      <section className="border-border bg-surface rounded-card-lg mt-3 border p-4">
        <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
          {r.payment_method === "cash" ? (
            <Banknote className="size-3.5" />
          ) : r.payment_method === "card" ? (
            <CreditCard className="size-3.5" />
          ) : (
            <Wallet className="size-3.5" />
          )}
          Paiement
        </h2>
        <dl className="mt-2 space-y-1 text-sm">
          <Row
            label="Méthode"
            value={
              r.payment_method === "cash"
                ? "Espèces"
                : r.payment_method === "card"
                  ? "Carte (en ligne)"
                  : "Coligo Pay"
            }
          />
          {(r.boost_amount_da ?? 0) > 0 && (
            <Row
              label="Boost client"
              value={formatDA(r.boost_amount_da ?? 0)}
            />
          )}
          {r.escrow_da > 0 && (
            <Row label="Séquestre en cours" value={formatDA(r.escrow_da)} />
          )}
          {(r.cash_due_da ?? 0) > 0 && (
            <Row
              label="Encaissé en espèces"
              value={formatDA(r.cash_due_da ?? 0)}
            />
          )}
          {r.commission_da != null && (
            <Row label="Commission Coligo" value={formatDA(r.commission_da)} />
          )}
          {r.chauffeur_net_da != null && (
            <Row label="Net chauffeur" value={formatDA(r.chauffeur_net_da)} />
          )}
          {(r.cashback_da ?? 0) > 0 && (
            <Row label="Cashback client" value={formatDA(r.cashback_da ?? 0)} />
          )}
          {(r.admin_refunded_da ?? 0) > 0 && (
            <Row
              label="Déjà remboursé (support)"
              value={`− ${formatDA(r.admin_refunded_da ?? 0)}`}
            />
          )}
        </dl>
        {ledger.length > 0 && (
          <div className="border-border mt-2 border-t pt-2">
            <p className="text-muted text-xs font-semibold">
              Grand livre chauffeur
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {ledger.map((l) => (
                <li
                  key={l.id}
                  className="text-muted flex justify-between gap-2"
                >
                  <span>
                    {dt(l.created_at)} · {l.type}
                    {l.note ? ` — ${l.note}` : ""}
                    {l.settled_at ? " · réglée" : ""}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatDA(l.amount_da)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ---- Actions ---- */}
      <RideAdminPanel
        ride={{
          id: r.id,
          status: r.status,
          chauffeurId: r.chauffeur_id,
          chauffeurName: chauffeur?.full_name ?? null,
          refundRemainingDa: refundRemaining,
          escrowDa: r.escrow_da,
        }}
      />

      {/* ---- Historique ---- */}
      <section className="border-border bg-surface rounded-card-lg mt-3 border p-4">
        <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
          <History className="size-3.5" />
          Historique complet
        </h2>
        <ol className="mt-3">
          {entries.map((e, i) => (
            <li key={e.key} className="relative flex gap-3 pb-4 last:pb-0">
              {i < entries.length - 1 && (
                <span
                  aria-hidden
                  className="bg-border absolute top-4 left-[5px] h-full w-px"
                />
              )}
              <span
                aria-hidden
                className={
                  "relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 " +
                  (e.kind === "admin"
                    ? "border-primary-600 bg-primary-100"
                    : e.kind === "event"
                      ? "border-border bg-surface-3"
                      : "border-success-600 bg-success-100")
                }
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {e.kind === "admin" && (
                    <ShieldCheck className="text-primary-700 mr-1 inline size-3.5 align-[-2px]" />
                  )}
                  {e.title}
                  <span className="text-subtle ml-2 text-xs font-normal tabular-nums">
                    {dt(e.at)}
                  </span>
                </p>
                {e.detail && (
                  <p className="text-muted mt-0.5 text-xs">{e.detail}</p>
                )}
                {(e.admin || e.ip) && (
                  <p className="text-subtle text-caption mt-0.5">
                    {e.admin ?? "admin"}
                    {e.ip ? ` · IP ${e.ip}` : ""}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-muted flex items-center justify-between">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
