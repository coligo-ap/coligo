"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import { adminCancelOrder, type AdminFormState } from "@/app/admin/actions";

// =============================================================================
// Gestion des profils livreurs (super-admin) — mig 0104.
// Toutes les écritures passent par le client service-role (bypass RLS) et sont
// gardées par isSuperAdmin() + tracées dans admin_audit_log.
// =============================================================================

async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

async function audit(
  action: string,
  driverId: string,
  note?: string | null,
  targetKind: "driver" | "order" = "driver",
  targetId?: string
) {
  try {
    const admin = createAdminClient();
    await admin.from("admin_audit_log").insert({
      admin_email: await adminEmail(),
      action,
      target_kind: targetKind,
      target_id: targetId ?? driverId,
      note: note ?? null,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action métier */
  }
}

function refreshDriver(driverId: string) {
  revalidatePath(`/admin/drivers/${driverId}`);
  revalidatePath("/admin/drivers");
}

const txt = (v: FormDataEntryValue | null): string | null => {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
};
const intOrNull = (v: FormDataEntryValue | null): number | null => {
  const s = txt(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

// ---------------------------------------------------------------------------
// 1. Profil (identité + véhicule + note interne)
// ---------------------------------------------------------------------------
export async function updateDriverProfile(
  driverId: string,
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  if (!driverId) return { error: "Livreur manquant." };

  const full_name = txt(formData.get("full_name"));
  if (!full_name) return { error: "Le nom est obligatoire." };
  const phone = txt(formData.get("phone"));
  if (!phone) return { error: "Le téléphone est obligatoire." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("drivers")
    .update({
      full_name,
      phone,
      email: txt(formData.get("email")),
      wilaya: txt(formData.get("wilaya")),
      address: txt(formData.get("address")),
      date_of_birth: txt(formData.get("date_of_birth")),
      national_id_number: txt(formData.get("national_id_number")),
      id_card_number: txt(formData.get("id_card_number")),
      vehicle_type: txt(formData.get("vehicle_type")),
      vehicle_brand: txt(formData.get("vehicle_brand")),
      vehicle_model: txt(formData.get("vehicle_model")),
      vehicle_color: txt(formData.get("vehicle_color")),
      vehicle_year: intOrNull(formData.get("vehicle_year")),
      vehicle_plate: txt(formData.get("vehicle_plate")),
      admin_note: txt(formData.get("admin_note")),
    })
    .eq("id", driverId);

  if (error) return { error: `Échec : ${error.message}` };
  await audit("update_driver_profile", driverId);
  refreshDriver(driverId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. Vérification du profil (vérifié / non vérifié)
// ---------------------------------------------------------------------------
export async function setDriverVerified(
  driverId: string,
  verified: boolean
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("drivers")
    .update({
      is_verified: verified,
      verified_at: verified ? new Date().toISOString() : null,
      verified_by: verified ? await adminEmail() : null,
    })
    .eq("id", driverId);
  if (error) return { error: error.message };
  await audit(verified ? "verify_driver" : "unverify_driver", driverId);
  refreshDriver(driverId);
  return {};
}

// ---------------------------------------------------------------------------
// 2bis. Photo de profil (bucket PUBLIC `driver-avatars`)
// ---------------------------------------------------------------------------
const AVATARS_BUCKET = "driver-avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_AVATAR = ["image/jpeg", "image/png", "image/webp"];

/** Extrait le chemin storage depuis une URL publique du bucket avatars. */
function avatarPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/${AVATARS_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

export async function updateDriverAvatar(
  driverId: string,
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choisis une image." };
  }
  if (file.size > MAX_AVATAR_BYTES)
    return { error: "Image trop lourde (max 5 Mo)." };
  if (!ALLOWED_AVATAR.includes(file.type)) {
    return { error: "Format accepté : JPG, PNG ou WEBP." };
  }

  const admin = createAdminClient();
  const ext =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : "jpg";
  const path = `${driverId}/${globalThis.crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(AVATARS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: `Upload échoué : ${upErr.message}` };

  const { data: pub } = admin.storage.from(AVATARS_BUCKET).getPublicUrl(path);

  // Ancienne photo (à nettoyer après mise à jour réussie).
  const { data: existing } = await admin
    .from("drivers")
    .select("avatar_url")
    .eq("id", driverId)
    .maybeSingle();
  const oldPath = avatarPathFromUrl(
    (existing?.avatar_url as string | null) ?? null
  );

  const { error } = await admin
    .from("drivers")
    .update({ avatar_url: pub.publicUrl })
    .eq("id", driverId);
  if (error) {
    await admin.storage.from(AVATARS_BUCKET).remove([path]);
    return { error: `Échec : ${error.message}` };
  }
  if (oldPath && oldPath !== path) {
    await admin.storage.from(AVATARS_BUCKET).remove([oldPath]);
  }

  await audit("update_driver_avatar", driverId);
  refreshDriver(driverId);
  return { ok: true };
}

export async function removeDriverAvatar(
  driverId: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("drivers")
    .select("avatar_url")
    .eq("id", driverId)
    .maybeSingle();
  const { error } = await admin
    .from("drivers")
    .update({ avatar_url: null })
    .eq("id", driverId);
  if (error) return { error: error.message };
  const path = avatarPathFromUrl(
    (existing?.avatar_url as string | null) ?? null
  );
  if (path) await admin.storage.from(AVATARS_BUCKET).remove([path]);
  await audit("remove_driver_avatar", driverId);
  refreshDriver(driverId);
  return {};
}

// ---------------------------------------------------------------------------
// 3. Documents d'identité (+ scan dans le bucket privé `driver-docs`)
// ---------------------------------------------------------------------------
const DOCS_BUCKET = "driver-docs";
const MAX_SCAN_BYTES = 8 * 1024 * 1024; // 8 Mo
const ALLOWED_SCAN = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

/** Génère une URL signée (1 h) pour afficher un scan côté serveur. */
export async function signDriverDocUrl(
  path: string
): Promise<{ url?: string; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DOCS_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

export async function upsertDriverDocument(
  driverId: string,
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const docType = txt(formData.get("doc_type"));
  const allowed = ["cni", "permis", "carte_grise", "passeport", "autre"];
  if (!docType || !allowed.includes(docType)) {
    return { error: "Type de pièce invalide." };
  }
  const id = txt(formData.get("doc_id"));
  const admin = createAdminClient();

  // Upload du scan (optionnel) → bucket privé, dossier {driver_id}/.
  let newPath: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_SCAN_BYTES) {
      return { error: "Scan trop lourd (max 8 Mo)." };
    }
    if (!ALLOWED_SCAN.includes(file.type)) {
      return { error: "Format accepté : JPG, PNG, WEBP ou PDF." };
    }
    const safe = (file.name || "scan").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${driverId}/${globalThis.crypto.randomUUID()}-${safe}`;
    const { error: upErr } = await admin.storage
      .from(DOCS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return { error: `Upload échoué : ${upErr.message}` };
    newPath = path;
  }

  // Ancien scan (pour le remplacer/nettoyer lors d'une édition).
  let oldPath: string | null = null;
  if (id) {
    const { data: existing } = await admin
      .from("driver_documents")
      .select("file_url")
      .eq("id", id)
      .maybeSingle();
    oldPath = (existing?.file_url as string | null) ?? null;
  }

  const base = {
    driver_id: driverId,
    doc_type: docType,
    number: txt(formData.get("number")),
    issued_at: txt(formData.get("issued_at")),
    expires_at: txt(formData.get("expires_at")),
    note: txt(formData.get("note")),
    updated_at: new Date().toISOString(),
  };
  // On ne touche file_url QUE si un nouveau scan a été fourni (préserve l'existant).
  const row = newPath ? { ...base, file_url: newPath } : base;

  const { error } = id
    ? await admin.from("driver_documents").update(row).eq("id", id)
    : await admin.from("driver_documents").insert(row);
  if (error) {
    // Rollback du scan fraîchement uploadé si l'écriture DB échoue.
    if (newPath) await admin.storage.from(DOCS_BUCKET).remove([newPath]);
    return { error: `Échec : ${error.message}` };
  }
  // Nettoie l'ancien scan une fois le remplacement confirmé.
  if (newPath && oldPath && oldPath !== newPath) {
    await admin.storage.from(DOCS_BUCKET).remove([oldPath]);
  }

  await audit("upsert_driver_document", driverId, docType);
  refreshDriver(driverId);
  return { ok: true };
}

export async function deleteDriverDocument(
  driverId: string,
  docId: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  // Récupère le chemin du scan pour le supprimer du bucket.
  const { data: doc } = await admin
    .from("driver_documents")
    .select("file_url")
    .eq("id", docId)
    .maybeSingle();
  const { error } = await admin
    .from("driver_documents")
    .delete()
    .eq("id", docId);
  if (error) return { error: error.message };
  const path = (doc?.file_url as string | null) ?? null;
  if (path) await admin.storage.from(DOCS_BUCKET).remove([path]);
  await audit("delete_driver_document", driverId);
  refreshDriver(driverId);
  return {};
}

// ---------------------------------------------------------------------------
// 4. Moyens de versement (multi-moyens)
// ---------------------------------------------------------------------------
export async function upsertDriverPayoutMethod(
  driverId: string,
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const method = txt(formData.get("method"));
  const allowed = ["especes", "ccp", "baridimob", "virement"];
  if (!method || !allowed.includes(method)) {
    return { error: "Moyen de versement invalide." };
  }
  const id = txt(formData.get("method_id"));
  const row = {
    driver_id: driverId,
    method,
    label: txt(formData.get("label")),
    account_number: txt(formData.get("account_number")),
    account_name: txt(formData.get("account_name")),
    is_default: formData.get("is_default") === "on",
  };

  const admin = createAdminClient();
  const { error } = id
    ? await admin.from("driver_payout_methods").update(row).eq("id", id)
    : await admin.from("driver_payout_methods").insert(row);
  if (error) return { error: `Échec : ${error.message}` };
  await audit("upsert_driver_payout", driverId, method);
  refreshDriver(driverId);
  return { ok: true };
}

export async function deleteDriverPayoutMethod(
  driverId: string,
  methodId: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("driver_payout_methods")
    .delete()
    .eq("id", methodId);
  if (error) return { error: error.message };
  await audit("delete_driver_payout", driverId);
  refreshDriver(driverId);
  return {};
}

// ---------------------------------------------------------------------------
// 5. Retrait / réattribution instantanée d'une commande
//    mode : 'pool' (réseau) · 'driver' (livreur précis) · 'cancel' (annulation)
// ---------------------------------------------------------------------------
export async function reassignDelivery(input: {
  orderId: string;
  driverId: string; // livreur actuel (pour revalidation de sa fiche)
  mode: "pool" | "driver" | "cancel";
  targetDriverId?: string | null;
  reason?: string | null;
}): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };

  // L'annulation réutilise la logique existante (remboursements, notifs).
  if (input.mode === "cancel") {
    const res = await adminCancelOrder(
      input.orderId,
      input.reason ?? "Retrait commande (admin)"
    );
    if (res.ok) refreshDriver(input.driverId);
    return res;
  }

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_reassign_delivery", {
    p_order_id: input.orderId,
    p_mode: input.mode,
    p_driver_id: input.targetDriverId ?? null,
  });
  if (error) return { error: error.message };

  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      order_not_found: "Commande introuvable.",
      not_delivery: "Ce n'est pas une commande de livraison.",
      already_terminal: "Commande déjà terminée ou annulée.",
      already_picked_up:
        "Commande déjà récupérée chez le commerçant — utilise l'annulation.",
      driver_required: "Choisis un livreur cible.",
      driver_unavailable: "Livreur cible introuvable ou gelé.",
      bad_mode: "Mode invalide.",
    };
    return { error: map[res.reason ?? ""] ?? "Réattribution impossible." };
  }

  await audit(
    input.mode === "pool" ? "reassign_order_pool" : "reassign_order_driver",
    input.driverId,
    input.mode === "driver" ? `→ ${input.targetDriverId}` : "réseau",
    "order",
    input.orderId
  );
  refreshDriver(input.driverId);
  revalidatePath("/admin/orders");
  return { ok: true };
}
