import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  FileText,
  Package,
  Star,
  TrendingUp,
  Truck,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminDomain } from "@/lib/auth/admin";
import { formatDA } from "@/lib/utils";
import { DriverFreezeButton } from "@/components/admin/driver-freeze-button";
import { DriverBlockButton } from "@/components/admin/drivers/driver-block-button";
import { DriverForceSignoutButton } from "@/components/admin/drivers/driver-force-signout-button";
import {
  DriverVerifyPanel,
  type VerifyStage,
} from "@/components/admin/drivers/driver-verify-panel";
import { getNotifyDriverOnVerify } from "@/app/admin/drivers/actions";
import {
  DriverProfileForm,
  type DriverProfile,
} from "@/components/admin/drivers/driver-profile-form";
import {
  DriverDocumentsManager,
  type DriverDocument,
} from "@/components/admin/drivers/driver-documents-manager";
import {
  DriverPayoutsManager,
  type DriverPayout,
} from "@/components/admin/drivers/driver-payouts-manager";
import {
  OrderReassign,
  type CandidateDriver,
} from "@/components/admin/drivers/order-reassign";
import { DriverAvatarUpload } from "@/components/admin/drivers/driver-avatar-upload";
import { DriverStatusBadge } from "@/components/admin/drivers/driver-status-badge";
import {
  DriverChangeRequests,
  type ChangeRequest,
} from "@/components/admin/drivers/driver-change-requests";

export const dynamic = "force-dynamic";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

type Period = "week" | "month" | "all";

/** Bornes de période (Alger UTC+1) en ISO UTC. */
function periodStart(period: Period): string | null {
  if (period === "all") return null;
  const TZ = 1;
  const now = new Date();
  const local = new Date(now.getTime() + TZ * 3600_000);
  let startLocalUTC: number;
  if (period === "week") {
    startLocalUTC = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - 6
    );
  } else {
    // month → 1er du mois courant
    startLocalUTC = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  }
  return new Date(startLocalUTC - TZ * 3600_000).toISOString();
}

export default async function AdminDriverDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  await requireAdminDomain("livraison");
  const { id } = await params;
  const sp = await searchParams;
  const period: Period =
    sp.period === "week" || sp.period === "all" ? sp.period : "month";

  const admin = createAdminClient();

  const { data: driver } = await admin
    .from("drivers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!driver) notFound();

  // Étape du parcours d'inscription (cf. lib/auth/driver-gate) + valeur par
  // défaut de l'interrupteur « Notifier automatiquement le livreur ».
  const verifyStage: VerifyStage = driver.is_verified
    ? "verified"
    : driver.submitted_at
      ? "pending"
      : "kyc";
  const notifyDefault = await getNotifyDriverOnVerify();

  const [{ data: docs }, { data: payouts }, { data: cap }] = await Promise.all([
    admin
      .from("driver_documents")
      .select(
        "id, doc_type, number, issued_at, expires_at, note, file_url, status, review_note"
      )
      .eq("driver_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("driver_payout_methods")
      .select("id, method, label, account_number, account_name, is_default")
      .eq("driver_id", id)
      .order("is_default", { ascending: false }),
    admin
      .from("platform_settings")
      .select("driver_float_cap_da")
      .eq("id", true)
      .maybeSingle(),
  ]);

  // --- Performance (tout temps) ---
  const [{ count: deliveredAll }, { count: cancelledAll }] = await Promise.all([
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_driver_id", id)
      .eq("status", "completed"),
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_driver_id", id)
      .eq("status", "cancelled"),
  ]);

  // --- Finances de la période (snapshots immuables sur orders) ---
  const since = periodStart(period);
  let q = admin
    .from("orders")
    .select(
      "payment_method, delivery_fee_da, driver_fee_da, driver_net_da, driver_owes_platform_da, driver_cash_collected_da"
    )
    .eq("delivery_driver_id", id)
    .not("delivery_delivered_at", "is", null);
  if (since) q = q.gte("delivery_delivered_at", since);
  const { data: finRows } = await q;
  type Fin = {
    payment_method: "cash" | "online";
    delivery_fee_da: number | null;
    driver_fee_da: number | null;
    driver_net_da: number | null;
    driver_owes_platform_da: number | null;
    driver_cash_collected_da: number | null;
  };
  const fin = (finRows ?? []) as Fin[];
  const sum = (f: (r: Fin) => number) => fin.reduce((s, r) => s + f(r), 0);
  const deliveriesPeriod = fin.length;
  const brut = sum((r) => r.delivery_fee_da ?? 0);
  const cotisations = sum((r) => r.driver_fee_da ?? 0);
  const net = sum((r) => r.driver_net_da ?? 0);
  const cashCollected = sum((r) => r.driver_cash_collected_da ?? 0);
  const toReverse = sum((r) => r.driver_owes_platform_da ?? 0); // cash → plateforme
  const toReceive = fin
    .filter((r) => r.payment_method === "online")
    .reduce((s, r) => s + (r.driver_net_da ?? 0), 0); // prépayé → plateforme doit
  const settlementNet = toReceive - toReverse;

  // --- Commandes actives (réattribuables) ---
  const { data: activeRows } = await admin
    .from("orders")
    .select(
      "id, order_number, status, payment_method, total_da, delivery_fee_da, delivery_address_text, delivery_picked_up_at, created_at, merchant_id"
    )
    .eq("delivery_driver_id", id)
    .not("status", "in", "(completed,cancelled)")
    .is("delivery_delivered_at", null)
    .order("created_at", { ascending: false });
  const active = activeRows ?? [];

  // --- Historique récent ---
  const { data: histRows } = await admin
    .from("orders")
    .select(
      "id, order_number, status, payment_method, driver_net_da, delivery_fee_da, delivery_delivered_at, delivery_address_text, merchant_id"
    )
    .eq("delivery_driver_id", id)
    .in("status", ["completed", "cancelled"])
    .order("delivery_delivered_at", { ascending: false, nullsFirst: false })
    .limit(15);
  const hist = histRows ?? [];

  // Noms commerçants (actives + historique).
  const merchantIds = Array.from(
    new Set(
      [...active, ...hist].map((o) => o.merchant_id).filter(Boolean) as string[]
    )
  );
  const { data: merchRows } = merchantIds.length
    ? await admin
        .from("merchants_public")
        .select("id, name")
        .in("id", merchantIds)
    : { data: [] as { id: string; name: string }[] };
  const merchName = new Map((merchRows ?? []).map((m) => [m.id, m.name]));

  // --- Facturation (relevés) ---
  const { data: statements } = await admin
    .from("driver_statements")
    .select(
      "id, period_start, period_end, net_da, direction, status, deliveries_count, due_at"
    )
    .eq("driver_id", id)
    .order("period_start", { ascending: false })
    .limit(8);

  // --- Demandes de modification du livreur ---
  const { data: changeReqRaw } = await admin
    .from("driver_change_requests")
    .select("id, kind, note, status, review_note, payload, created_at")
    .eq("driver_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  const changeRequests = (changeReqRaw ?? []) as ChangeRequest[];
  // Snapshot « avant » (valeurs actuelles) pour comparer aux demandes véhicule.
  const currentVehicle: Record<string, unknown> = {
    vehicle_type: driver.vehicle_type,
    vehicle_brand: driver.vehicle_brand,
    vehicle_model: driver.vehicle_model,
    vehicle_color: driver.vehicle_color,
    vehicle_year: driver.vehicle_year,
    vehicle_plate: driver.vehicle_plate,
    national_id_number: driver.national_id_number,
    id_card_number: driver.id_card_number,
    wilaya: driver.wilaya,
    address: driver.address,
  };
  const pendingReqCount = changeRequests.filter(
    (r) => r.status === "pending"
  ).length;

  // --- Candidats pour réattribution ---
  const { data: candRows } = await admin
    .from("drivers")
    .select("id, full_name")
    .neq("id", id)
    .eq("is_frozen", false)
    .order("full_name")
    .limit(200);
  const candidates = (candRows ?? []) as CandidateDriver[];

  // URLs signées (1 h) pour afficher les scans des pièces (bucket privé).
  const docList = (docs ?? []) as Array<{
    id: string;
    doc_type: string;
    number: string | null;
    issued_at: string | null;
    expires_at: string | null;
    note: string | null;
    file_url: string | null;
    status: string;
    review_note: string | null;
  }>;
  const documents: DriverDocument[] = await Promise.all(
    docList.map(async (d) => {
      let scanUrl: string | null = null;
      if (d.file_url) {
        const { data: signed } = await admin.storage
          .from("driver-docs")
          .createSignedUrl(d.file_url, 3600);
        scanUrl = signed?.signedUrl ?? null;
      }
      return {
        id: d.id,
        doc_type: d.doc_type,
        number: d.number,
        issued_at: d.issued_at,
        expires_at: d.expires_at,
        note: d.note,
        hasScan: !!d.file_url,
        scanUrl,
        status: d.status,
        review_note: d.review_note,
      };
    })
  );

  const profile: DriverProfile = {
    id: driver.id,
    full_name: driver.full_name,
    phone: driver.phone,
    email: driver.email,
    wilaya: driver.wilaya,
    address: driver.address,
    date_of_birth: driver.date_of_birth,
    national_id_number: driver.national_id_number,
    id_card_number: driver.id_card_number,
    vehicle_type: driver.vehicle_type,
    vehicle_brand: driver.vehicle_brand,
    vehicle_model: driver.vehicle_model,
    vehicle_color: driver.vehicle_color,
    vehicle_year: driver.vehicle_year,
    vehicle_plate: driver.vehicle_plate,
    admin_note: driver.admin_note,
  };

  const floatCap = (cap?.driver_float_cap_da as number | undefined) ?? 8000;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-4 lg:p-6">
      {/* En-tête */}
      <div>
        <Link
          href="/admin/drivers"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Tous les livreurs
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-4">
            <DriverAvatarUpload
              driverId={driver.id}
              avatarUrl={driver.avatar_url}
              initials={initialsOf(driver.full_name)}
            />
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <Truck className="size-6" />
                {driver.full_name}
              </h1>
              <p className="text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
                <span>{driver.phone}</span>
                {driver.email && <span>· {driver.email}</span>}
                {driver.wilaya && <span>· {driver.wilaya}</span>}
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                  {Number(driver.rating_avg ?? 0).toFixed(1)} (
                  {driver.rating_count})
                </span>
                <span>
                  · Inscrit le{" "}
                  {new Date(driver.created_at).toLocaleDateString("fr-FR")}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <DriverStatusBadge
                  isBlocked={driver.is_blocked}
                  isFrozen={driver.is_frozen}
                  isVerified={driver.is_verified}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2">
            <DriverVerifyPanel
              driverId={driver.id}
              verified={driver.is_verified ?? false}
              stage={verifyStage}
              notifyDefault={notifyDefault}
            />
            <div className="flex flex-wrap gap-2">
              <DriverFreezeButton
                driverId={driver.id}
                frozen={driver.is_frozen ?? false}
              />
              <DriverBlockButton
                driverId={driver.id}
                blocked={driver.is_blocked ?? false}
              />
              <DriverForceSignoutButton driverId={driver.id} />
            </div>
          </div>
        </div>

        {/* Dossier refusé : le motif communiqué au livreur reste visible ici. */}
        {driver.rejected_at && driver.rejection_reason && (
          <p className="border-warning-200 bg-warning-50 text-warning-800 mt-3 rounded-[12px] border px-4 py-2.5 text-xs">
            Dossier <strong>refusé</strong> le{" "}
            {new Date(driver.rejected_at).toLocaleDateString("fr-FR")} — motif
            communiqué : <em>{driver.rejection_reason}</em>. Le livreur peut
            corriger puis retransmettre son dossier.
          </p>
        )}
        {driver.is_blocked ? (
          <p className="border-danger-200 bg-danger-50 text-danger-700 mt-3 rounded-[12px] border px-4 py-2.5 text-xs">
            Ce livreur est <strong>bloqué</strong> (sanction dure) : aucun accès
            à ses pages — il ne voit qu&apos;un message de blocage.
            {driver.block_reason ? (
              <>
                {" "}
                Motif : <em>{driver.block_reason}</em>.
              </>
            ) : null}
          </p>
        ) : driver.is_frozen ? (
          <p className="border-warning-200 bg-warning-50 text-warning-800 mt-3 rounded-[12px] border px-4 py-2.5 text-xs">
            Ce livreur est <strong>gelé</strong> : il peut consulter son compte
            mais ne peut{" "}
            <strong>ni passer en ligne ni recevoir de course</strong>.
            {driver.freeze_reason ? (
              <>
                {" "}
                Motif : <em>{driver.freeze_reason}</em>.
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* Performance */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<Package className="size-4" />}
          label="Livraisons (total)"
          value={String(deliveredAll ?? 0)}
          tone="violet"
        />
        <Kpi
          icon={<TrendingUp className="size-4" />}
          label="Annulées (total)"
          value={String(cancelledAll ?? 0)}
          tone="amber"
        />
        <Kpi
          icon={<Star className="size-4" />}
          label="Note"
          value={`${Number(driver.rating_avg ?? 0).toFixed(1)} ★`}
          sub={`${driver.rating_count} avis`}
          tone="blue"
        />
        <Kpi
          icon={<Banknote className="size-4" />}
          label="Plafond encours"
          value={formatDA(floatCap)}
          tone="green"
        />
      </section>

      {/* Finances de la période */}
      <section className="border-border bg-surface rounded-[16px] border p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CreditCard className="size-4" />
            Finances
          </h2>
          <div className="bg-surface-2 flex gap-1 rounded-[10px] p-1 text-xs font-semibold">
            {(
              [
                ["week", "Semaine"],
                ["month", "Mois"],
                ["all", "Tout"],
              ] as const
            ).map(([v, l]) => (
              <Link
                key={v}
                href={`/admin/drivers/${id}?period=${v}`}
                className={
                  "rounded-[8px] px-3 py-1.5 " +
                  (period === v
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted")
                }
              >
                {l}
              </Link>
            ))}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
          <Money label="Livraisons" raw={String(deliveriesPeriod)} />
          <Money label="Gain brut (frais livraison)" value={brut} />
          <Money
            label="Cotisations Coligo (8%)"
            value={cotisations}
            tone="muted"
          />
          <Money label="Gain net livreur" value={net} tone="green" />
          <Money label="Cash encaissé" value={cashCollected} />
          <Money
            label="À reverser à la plateforme"
            value={toReverse}
            tone="amber"
          />
          <Money
            label="La plateforme lui doit"
            value={toReceive}
            tone="green"
          />
          <Money
            label="Solde net"
            value={Math.abs(settlementNet)}
            tone={settlementNet >= 0 ? "green" : "amber"}
            sub={
              settlementNet > 0
                ? "à recevoir"
                : settlementNet < 0
                  ? "à reverser"
                  : "équilibré"
            }
          />
        </dl>
        <p className="text-subtle mt-3 text-xs">
          Période :{" "}
          {period === "month"
            ? "mois courant"
            : period === "week"
              ? "7 derniers jours"
              : "depuis le début"}{" "}
          · valeurs figées par commande (snapshots immuables).
        </p>
      </section>

      {/* Demandes de modification (livreur vérifié) */}
      <section className="border-border bg-surface rounded-[16px] border p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
          <FileText className="size-4" />
          Demandes de modification
          {pendingReqCount > 0 && (
            <span className="bg-warning-100 text-warning-800 rounded-full px-2 py-0.5 text-xs font-bold">
              {pendingReqCount} en attente
            </span>
          )}
        </h2>
        <p className="text-muted mb-3 text-xs">
          Le livreur étant vérifié, ses infos sont verrouillées : il soumet des
          demandes. Vérifie, applique le changement via les sections ci-dessous,
          puis approuve/refuse.
        </p>
        <DriverChangeRequests
          driverId={id}
          requests={changeRequests}
          currentVehicle={currentVehicle}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Profil éditable */}
        <section className="border-border bg-surface rounded-[16px] border p-5">
          <h2 className="mb-4 text-base font-semibold">Profil & véhicule</h2>
          <DriverProfileForm driver={profile} />
        </section>

        <div className="space-y-6">
          {/* Documents */}
          <section className="border-border bg-surface rounded-[16px] border p-5">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
              <FileText className="size-4" />
              Pièces d&apos;identité
            </h2>
            <DriverDocumentsManager driverId={id} documents={documents} />
          </section>

          {/* Versement */}
          <section className="border-border bg-surface rounded-[16px] border p-5">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
              <Banknote className="size-4" />
              Moyens de versement
            </h2>
            <DriverPayoutsManager
              driverId={id}
              methods={(payouts ?? []) as DriverPayout[]}
            />
          </section>
        </div>
      </div>

      {/* Commandes actives + réattribution */}
      <section className="border-border bg-surface rounded-[16px] border p-5">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
          <Package className="size-4" />
          Commandes en cours ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-muted text-sm">Aucune commande en cours.</p>
        ) : (
          <ul className="space-y-3">
            {active.map((o) => (
              <li
                key={o.id}
                className="border-border rounded-[12px] border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {o.order_number ?? o.id.slice(0, 8)} ·{" "}
                      {merchName.get(o.merchant_id ?? "") ?? "Commerçant"}
                    </p>
                    <p className="text-muted truncate">
                      {o.delivery_address_text ?? "Adresse client"}
                    </p>
                    <p className="text-muted mt-1 text-xs">
                      <span className="bg-surface-2 rounded-full px-2 py-0.5 font-medium">
                        {o.status}
                      </span>{" "}
                      · {o.payment_method === "cash" ? "Espèces" : "Prépayé"}
                      {o.delivery_picked_up_at && " · déjà récupérée"}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {formatDA(o.total_da ?? 0)}
                  </span>
                </div>
                <OrderReassign
                  orderId={o.id}
                  driverId={id}
                  candidates={candidates}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Historique */}
        <section className="border-border bg-surface rounded-[16px] border p-5">
          <h2 className="mb-4 text-base font-semibold">Historique récent</h2>
          {hist.length === 0 ? (
            <p className="text-muted text-sm">Aucune course terminée.</p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {hist.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {merchName.get(o.merchant_id ?? "") ?? "Commerçant"}
                    </p>
                    <p className="text-muted truncate text-xs">
                      {o.delivery_address_text ?? "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={
                        "font-semibold tabular-nums " +
                        (o.status === "cancelled"
                          ? "text-danger-600"
                          : "text-success-700")
                      }
                    >
                      {o.status === "cancelled"
                        ? "Annulée"
                        : `+${formatDA(o.driver_net_da ?? o.delivery_fee_da ?? 0)}`}
                    </p>
                    <p className="text-muted text-xs">
                      {o.delivery_delivered_at
                        ? new Date(o.delivery_delivered_at).toLocaleDateString(
                            "fr-FR"
                          )
                        : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Facturation / relevés */}
        <section className="border-border bg-surface rounded-[16px] border p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <FileText className="size-4" />
            Facturation (relevés)
          </h2>
          {(statements ?? []).length === 0 ? (
            <p className="text-muted text-sm">Aucun relevé généré.</p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {(statements ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div>
                    <p className="font-medium tabular-nums">
                      {s.period_start} → {s.period_end}
                    </p>
                    <p className="text-muted text-xs">
                      {s.deliveries_count} livraisons · {s.status}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {s.direction === "receive" ? "+" : "−"}
                    {formatDA(Math.abs(s.net_da ?? 0))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "violet" | "blue" | "green" | "amber";
}) {
  const colors: Record<typeof tone, string> = {
    violet: "bg-violet-50 text-violet-700",
    blue: "bg-primary-50 text-primary-700",
    green: "bg-success-50 text-success-700",
    amber: "bg-warning-50 text-warning-700",
  };
  return (
    <div className={"rounded-[12px] p-3 " + colors[tone]}>
      <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs opacity-70">{sub}</p>}
    </div>
  );
}

function Money({
  label,
  value,
  raw,
  sub,
  tone,
}: {
  label: string;
  value?: number;
  raw?: string;
  sub?: string;
  tone?: "green" | "amber" | "muted";
}) {
  const color =
    tone === "green"
      ? "text-success-700"
      : tone === "amber"
        ? "text-warning-700"
        : tone === "muted"
          ? "text-muted"
          : "text-foreground";
  return (
    <div>
      <dt className="text-muted text-xs">{label}</dt>
      <dd className={"text-base font-semibold tabular-nums " + color}>
        {raw ?? formatDA(value ?? 0)}
        {sub && <span className="text-muted ml-1 text-xs">{sub}</span>}
      </dd>
    </div>
  );
}
