import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Car, FileCheck, User, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import { formatDA } from "@/lib/utils";
import {
  ChauffeurAccountActions,
  ChauffeurDocReview,
  ChauffeurInfoForm,
  type AdminChauffeurDoc,
} from "@/components/admin/chauffeur-detail";

export const dynamic = "force-dynamic";

/**
 * Fiche chauffeur complète : identité, documents (validation pièce par
 * pièce), véhicule/gamme, CCP, abonnement & dette, puis ACTIVATION du
 * compte (gatée sur les pièces obligatoires validées).
 */
export default async function AdminChauffeurDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isSuperAdmin())) redirect("/admin");
  const { id } = await params;
  const admin = createAdminClient();

  const [{ data: ch }, { data: docs }] = await Promise.all([
    admin.from("chauffeurs").select("*").eq("id", id).maybeSingle(),
    admin
      .from("chauffeur_documents")
      .select("*")
      .eq("chauffeur_id", id)
      .order("created_at"),
  ]);
  if (!ch) notFound();

  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const [
    { data: planData },
    { data: debtRows },
    { data: avgRow },
    { count: ridesCount },
  ] = await Promise.all([
    rpc("resolve_drive_plan", { p_chauffeur_id: id }),
    admin
      .from("ride_ledger")
      .select("amount_da")
      .eq("chauffeur_id", id)
      .eq("type", "chauffeur_owes_platform")
      .is("settled_at", null),
    admin
      .from("rides")
      .select("chauffeur_rating.avg()")
      .eq("chauffeur_id", id)
      .not("chauffeur_rating", "is", null)
      .maybeSingle(),
    admin
      .from("rides")
      .select("id", { count: "exact", head: true })
      .eq("chauffeur_id", id)
      .eq("status", "completed"),
  ]);
  const plan = (Array.isArray(planData) ? planData[0] : null) as {
    plan: string;
    rate: number;
  } | null;
  const debt = (debtRows ?? []).reduce((s, r) => s + (r.amount_da ?? 0), 0);
  const st = {
    avg: (avgRow as { avg?: number } | null)?.avg ?? null,
    count: ridesCount ?? 0,
  };

  const statusChip = ch.is_blocked ? (
    <span className="bg-danger-600 rounded-full px-2.5 py-1 text-xs font-bold text-white">
      Bloqué
    </span>
  ) : ch.is_frozen ? (
    <span className="bg-warning-500 rounded-full px-2.5 py-1 text-xs font-bold text-white">
      Gelé{ch.frozen_reason ? ` · ${ch.frozen_reason}` : ""}
    </span>
  ) : ch.is_verified ? (
    <span className="bg-success-600 rounded-full px-2.5 py-1 text-xs font-bold text-white">
      Actif
    </span>
  ) : ch.submitted_at ? (
    <span className="bg-warning-100 text-warning-800 rounded-full px-2.5 py-1 text-xs font-bold">
      Dossier à valider
    </span>
  ) : (
    <span className="bg-surface-2 text-muted rounded-full px-2.5 py-1 text-xs font-bold">
      Dossier incomplet
    </span>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 p-4 lg:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/chauffeurs"
          className="border-border hover:bg-surface-2 grid size-9 place-items-center rounded-[10px] border"
          aria-label="Retour"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{ch.full_name}</h1>
        {statusChip}
        {ch.is_demo && (
          <span className="bg-primary-50 text-primary-700 rounded-full px-2.5 py-1 text-xs font-bold">
            Compte démo
          </span>
        )}
      </header>

      {/* ── 1. Identité (obligatoire pour l'activation) ── */}
      <section className="bg-surface border-border rounded-[14px] border p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase">
          <User className="size-4" /> Identité
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Item k="Nom complet *" v={ch.full_name} />
          <Item k="Prénom *" v={ch.first_name ?? "—"} />
          <Item k="Téléphone * (= mot de passe démo)" v={ch.phone} />
          <Item k="Date de naissance *" v={ch.birth_date ?? "—"} />
          <Item k="Ville / wilaya *" v={ch.city ?? ch.wilaya ?? "—"} />
          <Item k="Adresse (facultatif)" v={ch.home_addr_text ?? "—"} />
          <Item
            k="Inscrit le"
            v={new Date(ch.created_at).toLocaleDateString("fr-FR")}
          />
          <Item
            k="Dossier envoyé le"
            v={
              ch.submitted_at
                ? new Date(ch.submitted_at).toLocaleDateString("fr-FR")
                : "—"
            }
          />
          <Item
            k="Note · courses"
            v={`${st?.avg ? `★ ${Math.round(Number(st.avg) * 10) / 10}` : "—"} · ${st?.count ?? 0} courses`}
          />
        </dl>
      </section>

      {/* ── 2. Documents — validation PIÈCE PAR PIÈCE ── */}
      <section className="bg-surface border-border rounded-[14px] border p-4">
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold uppercase">
          <FileCheck className="size-4" /> Documents — validation pièce par
          pièce
        </h2>
        <p className="text-muted mb-3 text-xs">
          <strong>Obligatoires</strong> : permis recto + verso, carte grise,
          photo de plaque, selfie en direct. <strong>Facultatif</strong> :
          assurance (« si disponible »). Une pièce refusée renvoie le motif au
          chauffeur ; une pièce re-soumise repasse automatiquement « à vérifier
          ».
        </p>
        <ChauffeurDocReview
          chauffeurId={id}
          docs={(docs ?? []) as AdminChauffeurDoc[]}
        />
      </section>

      {/* ── 3. Véhicule, gamme, CCP (fiche éditable) ── */}
      <section className="bg-surface border-border rounded-[14px] border p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase">
          <Car className="size-4" /> Véhicule, gamme & paiement
        </h2>
        <ChauffeurInfoForm
          chauffeurId={id}
          initial={{
            vehicle_make: ch.vehicle_make,
            vehicle_model: ch.vehicle_model,
            vehicle_color: ch.vehicle_color,
            vehicle_plate: ch.vehicle_plate,
            gamme: ch.gamme,
            home_addr_text: ch.home_addr_text,
            ccp_number: ch.ccp_number,
            ccp_key: ch.ccp_key,
            is_female: ch.is_female,
            is_female_verified: ch.is_female_verified,
          }}
        />
      </section>

      {/* ── 4. Abonnement & finances ── */}
      <section className="bg-surface border-border rounded-[14px] border p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase">
          <Wallet className="size-4" /> Abonnement & finances
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Item
            k="Plan"
            v={
              plan
                ? `${plan.plan === "free" ? "Gratuit" : plan.plan === "pro" ? "Pro" : "Premium"} · ${String(Math.round(Number(plan.rate) * 1000) / 10).replace(".", ",")} %`
                : "—"
            }
          />
          <Item k="Dette envers Coligo (non reversée)" v={formatDA(debt)} />
          <Item
            k="CCP chauffeur"
            v={
              ch.ccp_number
                ? `${ch.ccp_number}${ch.ccp_key ? ` — clé ${ch.ccp_key}` : ""}`
                : "Non renseigné (requis avant le 1er versement)"
            }
          />
        </dl>
      </section>

      {/* ── 5. Activation / gel / blocage ── */}
      <section className="bg-surface border-border rounded-[14px] border p-4">
        <h2 className="mb-1 text-sm font-bold uppercase">
          Activation du compte
        </h2>
        <p className="text-muted mb-3 text-xs">
          L&apos;activation est <strong>bloquée</strong> tant que
          l&apos;identité n&apos;est pas complète et que TOUTES les pièces
          obligatoires ne sont pas validées. Une fois activé, le chauffeur peut
          se connecter et recevoir des courses.
        </p>
        <ChauffeurAccountActions
          chauffeurId={id}
          isVerified={!!ch.is_verified}
          isFrozen={!!ch.is_frozen}
          isBlocked={!!ch.is_blocked}
        />
      </section>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted text-xs">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
