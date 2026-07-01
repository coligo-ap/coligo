"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Res = { ok?: true; error?: string };
const DENIED: Res = { error: "Accès refusé." };

/** Email de l'admin courant (traçabilité). */
async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

/** Journalise l'action admin (best-effort, ne bloque jamais l'opération). */
async function audit(action: string, walletId: string, note?: string | null) {
  try {
    const admin = createAdminClient();
    await (
      admin.from as unknown as (t: string) => {
        insert: (v: Record<string, unknown>) => Promise<unknown>;
      }
    )("admin_audit_log").insert({
      admin_email: await adminEmail(),
      action,
      target_kind: "partner",
      target_id: walletId,
      note: note ?? null,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action métier */
  }
}

/** Mutation générique d'un portefeuille partenaire (service_role, RLS bypass). */
async function patchWallet(
  walletId: string,
  patch: Record<string, unknown>
): Promise<Res> {
  const admin = createAdminClient();
  const { error } = await (
    admin.from as unknown as (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )("operator_wallets")
    .update(patch)
    .eq("id", walletId);
  if (error) return { error: error.message };
  revalidatePath("/admin/agents");
  revalidatePath(`/admin/agents/${walletId}`);
  return { ok: true };
}

/** URL signée d'une pièce du dossier (bucket privé partner-docs). */
export async function signAgentDocUrl(
  path: string
): Promise<{ url?: string; error?: string }> {
  if (!(await adminCan("finances"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("partner-docs")
    .createSignedUrl(path, 3600);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

/** Valide / refuse une pièce du dossier (statut de vérification + motif). */
export async function setAgentDocumentStatus(
  walletId: string,
  docId: string,
  status: "approved" | "rejected",
  note?: string | null
): Promise<Res> {
  if (!(await adminCan("finances"))) return DENIED;
  const admin = createAdminClient();
  const { error } = await (
    admin.from as unknown as (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )("partner_documents")
    .update({
      status,
      review_note: note ?? null,
      reviewed_by: await adminEmail(),
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", docId);
  if (error) return { error: error.message };
  await audit(
    status === "approved" ? "approve_agent_doc" : "reject_agent_doc",
    walletId,
    note ?? null
  );
  revalidatePath(`/admin/agents/${walletId}`);
  return { ok: true };
}

/** Approuver le dossier → le point devient ACTIF (peut revendre + visible). */
export async function approveAgent(walletId: string): Promise<Res> {
  if (!(await adminCan("finances"))) return DENIED;
  const res = await patchWallet(walletId, {
    status: "active",
    rejected_reason: null,
  });
  if (res.ok) await audit("approve_agent", walletId);
  return res;
}

/** Refuser le dossier (motif visible par l'agent dans son espace). */
export async function rejectAgent(
  walletId: string,
  reason: string
): Promise<Res> {
  if (!(await adminCan("finances"))) return DENIED;
  if (!reason.trim()) return { error: "Motif requis." };
  const res = await patchWallet(walletId, {
    status: "rejected",
    rejected_reason: reason.trim(),
    is_verified: false,
    verified_at: null,
    verified_by: null,
  });
  if (res.ok) await audit("reject_agent", walletId, reason.trim());
  return res;
}

/** Attribuer / retirer le badge « vérifié ». */
export async function setAgentVerified(
  walletId: string,
  verified: boolean
): Promise<Res> {
  if (!(await adminCan("finances"))) return DENIED;
  const res = await patchWallet(walletId, {
    is_verified: verified,
    verified_at: verified ? new Date().toISOString() : null,
    verified_by: verified ? await adminEmail() : null,
  });
  if (res.ok)
    await audit(verified ? "verify_agent" : "unverify_agent", walletId);
  return res;
}

/** Suspendre / désactiver / réactiver un point. */
export async function setAgentStatus(
  walletId: string,
  status: "active" | "suspended" | "disabled"
): Promise<Res> {
  if (!(await adminCan("finances"))) return DENIED;
  const res = await patchWallet(walletId, { status });
  if (res.ok) await audit("set_agent_status", walletId, status);
  return res;
}

/** Modifier les informations du point (corrections admin). */
export async function updateAgent(
  walletId: string,
  fields: {
    displayName: string;
    ownerName?: string;
    registreCommerce?: string;
    phone?: string;
    address?: string;
    wilaya?: string;
    commune?: string;
    hours?: string;
  }
): Promise<Res> {
  if (!(await adminCan("finances"))) return DENIED;
  if (!fields.displayName.trim()) return { error: "Nom du point requis." };
  const res = await patchWallet(walletId, {
    display_name: fields.displayName.trim(),
    owner_name: fields.ownerName?.trim() || null,
    registre_commerce: fields.registreCommerce?.trim() || null,
    phone: fields.phone?.trim() || null,
    address: fields.address?.trim() || null,
    wilaya: fields.wilaya?.trim() || null,
    commune: fields.commune?.trim() || null,
    hours: fields.hours?.trim() || null,
  });
  if (res.ok) await audit("update_agent", walletId);
  return res;
}
