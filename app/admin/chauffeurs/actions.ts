"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";

// =============================================================================
// Gestion des chauffeurs VTC (super-admin).
// Population SÉPARÉE des livreurs (table `chauffeurs`, mig 0131). Un chauffeur
// est créé avec is_verified=false et NE PEUT PAS rouler tant que l'admin ne l'a
// pas vérifié (chauffeurs_present_near exige is_verified + !frozen + !blocked).
// Écritures via service-role (bypass RLS), gardées par isSuperAdmin() + audit.
// =============================================================================

async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

async function audit(action: string, chauffeurId: string) {
  try {
    const admin = createAdminClient();
    await admin.from("admin_audit_log").insert({
      admin_email: await adminEmail(),
      action,
      target_kind: "chauffeur",
      target_id: chauffeurId,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action métier */
  }
}

type ChauffeurFlags = {
  is_verified?: boolean;
  is_frozen?: boolean;
  is_blocked?: boolean;
};

async function setFlag(
  chauffeurId: string,
  patch: ChauffeurFlags,
  action: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  if (!chauffeurId) return { error: "Chauffeur manquant." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("chauffeurs")
    .update(patch)
    .eq("id", chauffeurId);
  if (error) return { error: error.message };
  await audit(action, chauffeurId);
  revalidatePath("/admin/chauffeurs");
  return {};
}

/** Vérifie (ou retire la vérif) — autorise/interdit le chauffeur à rouler. */
export async function setChauffeurVerified(
  chauffeurId: string,
  verified: boolean
): Promise<{ error?: string }> {
  return setFlag(
    chauffeurId,
    { is_verified: verified },
    verified ? "verify_chauffeur" : "unverify_chauffeur"
  );
}

/** Gel souple (le chauffeur ne reçoit plus de courses, mais reste vérifié). */
export async function setChauffeurFrozen(
  chauffeurId: string,
  frozen: boolean
): Promise<{ error?: string }> {
  return setFlag(
    chauffeurId,
    { is_frozen: frozen },
    frozen ? "freeze_chauffeur" : "unfreeze_chauffeur"
  );
}

/** Blocage dur (compte suspendu). */
export async function setChauffeurBlocked(
  chauffeurId: string,
  blocked: boolean
): Promise<{ error?: string }> {
  return setFlag(
    chauffeurId,
    { is_blocked: blocked },
    blocked ? "block_chauffeur" : "unblock_chauffeur"
  );
}

// =============================================================================
// DRIVE — file de validation (docs + selfie), motifs, paiements CCP, config.
// =============================================================================

const DOCS_BUCKET = "driver-docs";

/** URL signée (1 h) d'un document chauffeur (bucket privé). */
export async function getChauffeurDocUrl(
  path: string
): Promise<{ url?: string; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DOCS_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return { error: error?.message ?? "Échec." };
  return { url: data.signedUrl };
}

/** Approuve le dossier : le chauffeur peut se connecter et recevoir des courses. */
export async function approveChauffeur(
  chauffeurId: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("chauffeurs")
    .update({
      is_verified: true,
      verified_at: new Date().toISOString(),
      rejected_reason: null,
    })
    .eq("id", chauffeurId)
    .select("user_id, first_name, full_name")
    .maybeSingle();
  if (error) return { error: error.message };
  await audit("approve_chauffeur", chauffeurId);
  // FCM au chauffeur : compte activé.
  if (data?.user_id) {
    try {
      const { sendFcm } = await import("@/lib/fcm/send");
      const { data: tokens } = await admin
        .from("device_tokens")
        .select("token")
        .eq("user_id", data.user_id)
        .eq("role", "chauffeur");
      const list = (tokens ?? []).map((t) => t.token).filter(Boolean);
      if (list.length > 0) {
        await sendFcm(
          list,
          {
            title: "Compte activé ✓",
            body: "Votre dossier est validé — vous pouvez recevoir des courses Coligo Drive.",
          },
          { route: "/chauffeur", kind: "drive_approved" }
        );
      }
    } catch {
      /* best-effort */
    }
  }
  revalidatePath("/admin/chauffeurs");
  return {};
}

/** Refuse le dossier avec motif : le chauffeur doit compléter ses documents. */
export async function rejectChauffeur(
  chauffeurId: string,
  motif: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  if (!motif.trim()) return { error: "Motif requis." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("chauffeurs")
    .update({
      is_verified: false,
      submitted_at: null,
      rejected_reason: motif.trim(),
    })
    .eq("id", chauffeurId)
    .select("user_id")
    .maybeSingle();
  if (error) return { error: error.message };
  await audit("reject_chauffeur", chauffeurId);
  if (data?.user_id) {
    try {
      const { sendFcm } = await import("@/lib/fcm/send");
      const { data: tokens } = await admin
        .from("device_tokens")
        .select("token")
        .eq("user_id", data.user_id)
        .eq("role", "chauffeur");
      const list = (tokens ?? []).map((t) => t.token).filter(Boolean);
      if (list.length > 0) {
        await sendFcm(
          list,
          {
            title: "Dossier refusé",
            body: `${motif.trim()} — complétez vos documents puis renvoyez le dossier.`,
          },
          { route: "/chauffeur/documents", kind: "drive_rejected" }
        );
      }
    } catch {
      /* best-effort */
    }
  }
  revalidatePath("/admin/chauffeurs");
  return {};
}

/** Gel souple AVEC MOTIF (affiché sur l'écran « Compte gelé » du chauffeur). */
export async function freezeChauffeurWithReason(
  chauffeurId: string,
  motif: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("chauffeurs")
    .update({
      is_frozen: true,
      frozen_reason: motif.trim() || null,
      frozen_at: new Date().toISOString(),
    })
    .eq("id", chauffeurId);
  if (error) return { error: error.message };
  await audit("freeze_chauffeur", chauffeurId);
  revalidatePath("/admin/chauffeurs");
  return {};
}

/** Valide un paiement d'abonnement CCP (active le plan, recette comptabilisée). */
export async function approveSubPayment(
  paymentId: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("drive_sub_mark_paid", {
    p_payment_id: paymentId,
    p_reviewer: await adminEmail(),
  });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
    chauffeur_user_id?: string | null;
    plan?: string;
  };
  if (!row?.ok) return { error: row?.reason ?? "Échec." };
  if (row.chauffeur_user_id) {
    try {
      const { sendFcm } = await import("@/lib/fcm/send");
      const { data: tokens } = await admin
        .from("device_tokens")
        .select("token")
        .eq("user_id", row.chauffeur_user_id)
        .eq("role", "chauffeur");
      const list = (tokens ?? []).map((t) => t.token).filter(Boolean);
      if (list.length > 0) {
        await sendFcm(
          list,
          {
            title: "Abonnement activé ✓",
            body: `Votre paiement est vérifié — abonnement ${row.plan === "premium" ? "Premium" : "Pro"} actif pour 30 jours.`,
          },
          { route: "/chauffeur/abonnement", kind: "drive_sub_active" }
        );
      }
    } catch {
      /* best-effort */
    }
  }
  revalidatePath("/admin/chauffeurs");
  return {};
}

/** Rejette un paiement CCP (reçu introuvable / montant incorrect). */
export async function rejectSubPayment(
  paymentId: string,
  note: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("drive_sub_reject", {
    p_payment_id: paymentId,
    p_note: note || null,
    p_reviewer: await adminEmail(),
  });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  if (!row?.ok) return { error: row?.reason ?? "Échec." };
  revalidatePath("/admin/chauffeurs");
  return {};
}

// =============================================================================
// VALIDATION PIÈCE PAR PIÈCE (mig 0148) + fiche chauffeur.
// Obligatoire : permis recto/verso, carte grise, plaque, selfie.
// Facultatif : assurance, adresse, CCP (requis avant le 1er versement).
// =============================================================================

// NB : PAS exporté — un fichier "use server" ne peut exporter que des
// fonctions async (un export de constante fait planter toutes les actions).
const REQUIRED_DOC_KINDS = [
  "permis_recto",
  "permis_verso",
  "carte_grise",
  "plaque",
  "selfie",
] as const;

const DOC_KIND_LABEL: Record<string, string> = {
  permis_recto: "Permis (recto)",
  permis_verso: "Permis (verso)",
  carte_grise: "Carte grise",
  plaque: "Photo de plaque",
  assurance: "Assurance",
  selfie: "Selfie",
};

/** Valide ou refuse UNE pièce (avec motif transmis au chauffeur). */
export async function setChauffeurDocStatus(
  chauffeurId: string,
  docId: string,
  status: "approved" | "rejected",
  note?: string | null
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data: doc, error } = await admin
    .from("chauffeur_documents")
    .update({
      status,
      review_note: note ?? null,
      reviewed_by: await adminEmail(),
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", docId)
    .eq("chauffeur_id", chauffeurId)
    .select("kind")
    .maybeSingle();
  if (error) return { error: error.message };
  await audit(`doc_${status}`, chauffeurId);

  // La décision (et la note) est communiquée au chauffeur par push — le
  // statut/motif est aussi visible sur sa pièce dans /chauffeur/documents.
  try {
    const { data: ch } = await admin
      .from("chauffeurs")
      .select("user_id")
      .eq("id", chauffeurId)
      .maybeSingle();
    if (ch?.user_id) {
      const { data: tokens } = await admin
        .from("device_tokens")
        .select("token")
        .eq("user_id", ch.user_id)
        .eq("role", "chauffeur");
      const list = (tokens ?? []).map((t) => t.token).filter(Boolean);
      if (list.length > 0) {
        const label = DOC_KIND_LABEL[doc?.kind ?? ""] ?? "Document";
        const { sendFcm } = await import("@/lib/fcm/send");
        await sendFcm(
          list,
          status === "approved"
            ? {
                title: `${label} validé ✓`,
                body: note?.trim() || "Votre pièce a été vérifiée et acceptée.",
              }
            : {
                title: `${label} refusé`,
                body: `${note?.trim() || "Pièce non conforme."} — renvoyez-la depuis vos documents.`,
              },
          { route: "/chauffeur/documents", kind: "doc_review" }
        );
      }
    }
  } catch {
    /* best-effort : la décision reste visible dans l'app */
  }

  revalidatePath(`/admin/chauffeurs/${chauffeurId}`);
  return {};
}

/** Met à jour la fiche (véhicule, adresse, CCP) depuis la carte grise & docs. */
export async function updateChauffeurInfo(
  chauffeurId: string,
  patch: {
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_color?: string | null;
    vehicle_plate?: string | null;
    gamme?: "classic" | "confort" | "moto";
    home_addr_text?: string | null;
    ccp_number?: string | null;
    ccp_key?: string | null;
    is_female?: boolean;
    is_female_verified?: boolean;
  }
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("chauffeurs")
    .update(patch)
    .eq("id", chauffeurId);
  if (error) return { error: error.message };
  await audit("update_chauffeur_info", chauffeurId);
  revalidatePath(`/admin/chauffeurs/${chauffeurId}`);
  return {};
}

/**
 * Activation du compte GATÉE : toutes les pièces OBLIGATOIRES doivent être
 * VALIDÉES (et l'identité complète) avant que le chauffeur puisse travailler.
 */
export async function approveChauffeurGated(
  chauffeurId: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const [{ data: ch }, { data: docs }] = await Promise.all([
    admin
      .from("chauffeurs")
      .select("first_name, full_name, phone, birth_date, city, wilaya")
      .eq("id", chauffeurId)
      .maybeSingle(),
    admin
      .from("chauffeur_documents")
      .select("kind, status")
      .eq("chauffeur_id", chauffeurId),
  ]);
  if (!ch) return { error: "Chauffeur introuvable." };

  const missingId: string[] = [];
  if (!ch.full_name?.trim()) missingId.push("nom/prénom");
  if (!ch.phone?.trim()) missingId.push("téléphone");
  if (!ch.birth_date) missingId.push("date de naissance");
  if (!ch.city?.trim() && !ch.wilaya?.trim()) missingId.push("ville/wilaya");

  const byKind = new Map((docs ?? []).map((d) => [d.kind, d.status]));
  const missingDocs = REQUIRED_DOC_KINDS.filter(
    (k) => byKind.get(k) !== "approved"
  );
  if (missingId.length > 0 || missingDocs.length > 0) {
    const labels: Record<string, string> = {
      permis_recto: "permis (recto)",
      permis_verso: "permis (verso)",
      carte_grise: "carte grise",
      plaque: "photo de plaque",
      selfie: "selfie",
    };
    return {
      error:
        "Activation impossible — à compléter/valider d'abord : " +
        [...missingId, ...missingDocs.map((k) => labels[k] ?? k)].join(", ") +
        ".",
    };
  }
  return approveChauffeur(chauffeurId);
}
