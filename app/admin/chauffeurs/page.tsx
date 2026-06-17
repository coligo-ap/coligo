import { redirect } from "next/navigation";
import { Car, CreditCard, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import { ChauffeurActions } from "@/components/admin/chauffeur-actions";
import {
  ChauffeurValidationCard,
  SubPaymentActions,
} from "@/components/admin/chauffeur-validation";
import { formatDA } from "@/lib/utils";
import { ModulePaymentAccount } from "@/components/admin/module-payment-account";

export const dynamic = "force-dynamic";

export default async function AdminChauffeursPage() {
  if (!(await isSuperAdmin())) redirect("/admin");

  const admin = createAdminClient();
  const [{ data: chauffeurs }, { data: pendingPayments }] = await Promise.all([
    admin
      .from("chauffeurs")
      .select(
        "id, full_name, phone, city, gamme, birth_date, vehicle_make, vehicle_model, vehicle_plate, is_verified, is_frozen, is_blocked, frozen_reason, submitted_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(500),
    admin
      .from("chauffeur_subscription_payments")
      .select(
        "id, plan, amount_da, method, reference, created_at, chauffeurs(full_name, phone)"
      )
      .eq("status", "pending")
      .eq("method", "ccp")
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  const rows = chauffeurs ?? [];
  // File de validation : dossier ENVOYÉ (docs + selfie) et pas encore vérifié.
  const queue = rows.filter(
    (c) => !c.is_verified && !c.is_blocked && c.submitted_at
  );
  const queueDocs = new Map<string, { kind: string; url: string }[]>();
  if (queue.length > 0) {
    const { data: docs } = await admin
      .from("chauffeur_documents")
      .select("chauffeur_id, kind, url")
      .in(
        "chauffeur_id",
        queue.map((c) => c.id)
      );
    for (const d of docs ?? []) {
      const list = queueDocs.get(d.chauffeur_id) ?? [];
      list.push({ kind: d.kind, url: d.url });
      queueDocs.set(d.chauffeur_id, list);
    }
  }
  const payments = pendingPayments ?? [];

  const vehicleOf = (c: (typeof rows)[number]) =>
    [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ") || "—";

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-5 flex items-center gap-2">
        <Car className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Chauffeurs Drive</h1>
        {queue.length > 0 && (
          <span className="bg-warning-100 text-warning-800 ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold">
            {queue.length} dossier{queue.length > 1 ? "s" : ""} à valider
          </span>
        )}
      </header>

      {/* ── File de validation (docs + selfie) ── */}
      {queue.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase">
            <ShieldCheck className="size-4" /> File de validation
          </h2>
          <p className="text-muted mb-3 text-sm">
            Vérifiez les documents et le <strong>selfie en direct</strong>, puis
            approuvez ou refusez avec motif. Le chauffeur est notifié (FCM) et
            ne peut pas rouler avant validation.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {queue.map((c) => (
              <ChauffeurValidationCard
                key={c.id}
                chauffeur={{
                  id: c.id,
                  full_name: c.full_name,
                  phone: c.phone,
                  city: c.city,
                  gamme: c.gamme,
                  birth_date: c.birth_date,
                  submitted_at: c.submitted_at,
                }}
                docs={queueDocs.get(c.id) ?? []}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Paiements d'abonnement CCP en vérification (24 h) ── */}
      {payments.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase">
            <CreditCard className="size-4" /> Abonnements CCP à vérifier
          </h2>
          <div className="bg-surface border-border overflow-x-auto rounded-[14px] border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-muted text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Chauffeur</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Montant</th>
                  <th className="px-3 py-2 text-left">Référence</th>
                  <th className="px-3 py-2 text-left">Demandé le</th>
                  <th className="px-3 py-2 text-right">Vérification</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const ch = p.chauffeurs as unknown as {
                    full_name: string;
                    phone: string;
                  } | null;
                  return (
                    <tr key={p.id} className="border-border border-t">
                      <td className="px-3 py-2 font-medium">
                        {ch?.full_name ?? "—"}
                        <span className="text-muted block text-xs tabular-nums">
                          {ch?.phone}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-semibold capitalize">
                        {p.plan}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatDA(p.amount_da)}
                      </td>
                      <td className="text-muted px-3 py-2 tabular-nums">
                        {p.reference ?? "—"}
                      </td>
                      <td className="text-muted px-3 py-2">
                        {new Date(p.created_at).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <SubPaymentActions paymentId={p.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-muted mb-4 text-sm">
        Un chauffeur ne peut <strong>recevoir des courses</strong> qu&apos;une
        fois <strong>vérifié</strong>. « Geler » le retire temporairement du
        réseau (écran « Compte gelé » avec motif) ; « Bloquer » suspend le
        compte. Barème, seuils de gel, cashback et CCP se règlent dans{" "}
        <a
          href="/admin/drive"
          className="text-primary-700 font-semibold underline"
        >
          Config Drive
        </a>
        .
      </p>

      {rows.length === 0 ? (
        <div className="bg-surface border-border text-muted rounded-[14px] border p-8 text-center text-sm">
          Aucun chauffeur inscrit pour l&apos;instant.
        </div>
      ) : (
        <div className="bg-surface border-border overflow-x-auto rounded-[14px] border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Téléphone</th>
                <th className="px-3 py-2 text-left">Gamme</th>
                <th className="px-3 py-2 text-left">Véhicule</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-border border-t">
                  <td className="px-3 py-2 font-medium">
                    <a
                      href={`/admin/chauffeurs/${c.id}`}
                      className="text-primary-700 hover:underline"
                    >
                      {c.full_name}
                    </a>
                  </td>
                  <td className="text-muted px-3 py-2 tabular-nums">
                    {c.phone}
                  </td>
                  <td className="px-3 py-2 capitalize">{c.gamme}</td>
                  <td className="text-muted px-3 py-2">
                    {vehicleOf(c)}
                    {c.vehicle_plate ? ` · ${c.vehicle_plate}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    {c.is_blocked ? (
                      <span className="text-danger-700 text-xs font-bold">
                        Bloqué
                      </span>
                    ) : c.is_frozen ? (
                      <span className="text-warning-800 text-xs font-bold">
                        Gelé{c.frozen_reason ? ` · ${c.frozen_reason}` : ""}
                      </span>
                    ) : c.is_verified ? (
                      <span className="text-success-700 text-xs font-bold">
                        Actif
                      </span>
                    ) : c.submitted_at ? (
                      <span className="text-warning-800 text-xs font-bold">
                        À valider
                      </span>
                    ) : (
                      <span className="text-muted text-xs">
                        Dossier incomplet
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ChauffeurActions
                      chauffeurId={c.id}
                      isVerified={!!c.is_verified}
                      isFrozen={!!c.is_frozen}
                      isBlocked={!!c.is_blocked}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6">
        <ModulePaymentAccount scope="chauffeur" />
      </div>
    </div>
  );
}
