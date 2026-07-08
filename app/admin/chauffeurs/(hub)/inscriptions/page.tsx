import { redirect } from "next/navigation";
import { CreditCard, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import {
  ChauffeurValidationCard,
  SubPaymentActions,
} from "@/components/admin/chauffeur-validation";
import { formatDA } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Onglet « Inscriptions » du hub Coligo Drive : file de validation des nouveaux
// chauffeurs (docs + selfie) + abonnements CCP à vérifier. Un chauffeur ne peut
// recevoir de course qu'une fois vérifié.
export default async function ChauffeurRegistrationsTab() {
  if (!(await isSuperAdmin())) redirect("/admin");

  const admin = createAdminClient();
  const [{ data: chauffeurs }, { data: pendingPayments }] = await Promise.all([
    admin
      .from("chauffeurs")
      .select(
        "id, full_name, phone, city, gamme, birth_date, is_verified, is_blocked, submitted_at"
      )
      .order("submitted_at", { ascending: true })
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

  return (
    <div className="space-y-8">
      <section
        data-alert-focus="chauffeur_pending_validation"
        className="rounded-[16px]"
      >
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase">
          <ShieldCheck className="size-4" /> File de validation ({queue.length})
        </h2>
        <p className="text-muted mb-3 text-sm">
          Vérifiez les documents et le <strong>selfie en direct</strong>, puis
          approuvez ou refusez avec motif. Le chauffeur est notifié (FCM) et ne
          peut pas rouler avant validation.
        </p>
        {queue.length === 0 ? (
          <p className="text-muted text-sm">
            Aucun dossier en attente. Tout est traité ✅
          </p>
        ) : (
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
        )}
      </section>

      {payments.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase">
            <CreditCard className="size-4" /> Abonnements CCP à vérifier (
            {payments.length})
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
    </div>
  );
}
