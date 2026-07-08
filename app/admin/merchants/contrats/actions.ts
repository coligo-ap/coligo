"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { validateUploadedFile, MB } from "@/lib/security/file-validation";
import type {
  ContractParty,
  ContractTerms,
} from "@/lib/types/merchant-contract";

const PATH = "/admin/merchants/contrats";

export type ContractActionState = { error?: string; success?: string };

// ─────────────────────────────────────────────────────────────────────────────
// Pré-remplissage : identifie un commerçant existant (fiche + email du compte
// auth + taux effectifs) pour remplir le formulaire en un clic.
// ─────────────────────────────────────────────────────────────────────────────
export async function getContractPrefill(merchantId: string): Promise<{
  error?: string;
  party?: Partial<ContractParty>;
  commission_cash_pct?: number;
  commission_online_pct?: number;
}> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const supabase = await createClient();

  const [{ data: m }, { data: platform }] = await Promise.all([
    supabase
      .from("merchants")
      .select(
        "user_id, name, manager_name, address, commune, city, wilaya_code, phone_public, commission_cash, commission_online"
      )
      .eq("id", merchantId)
      .maybeSingle(),
    supabase
      .from("platform_settings")
      .select("commission_cash, commission_online")
      .maybeSingle(),
  ]);
  if (!m) return { error: "Commerçant introuvable." };

  // Email du compte auth : lecture service_role, gardée par le gate admin
  // ci-dessus (règle self-guard des lectures createAdminClient).
  let email = "";
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    email = data?.user?.email ?? "";
  } catch {
    /* email absent = champ à saisir à la main */
  }

  const pct = (v: unknown, fallback: unknown) => {
    const n = Number(v ?? fallback ?? 0);
    // Les taux sont stockés en fraction (0.08) — le formulaire parle en %.
    return Math.round(n * 1000) / 10;
  };

  return {
    party: {
      merchant_name: m.name ?? "",
      representative: m.manager_name ?? "",
      address: m.address ?? "",
      commune: m.commune ?? m.city ?? "",
      wilaya: m.wilaya_code ?? "",
      phone: m.phone_public ?? "",
      email,
    },
    commission_cash_pct: pct(m.commission_cash, platform?.commission_cash),
    commission_online_pct: pct(
      m.commission_online,
      platform?.commission_online
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Émission d'un contrat
// ─────────────────────────────────────────────────────────────────────────────
export async function createMerchantContract(payload: {
  merchant_id: string | null;
  party: ContractParty;
  terms: ContractTerms;
  notes: string;
}): Promise<{ error?: string; id?: string }> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };

  const { party, terms } = payload;
  if (!party.merchant_name.trim()) {
    return { error: "La raison sociale du commerçant est obligatoire." };
  }
  if (!party.rc_number.trim()) {
    return {
      error:
        "Le n° d'immatriculation (RC / équivalent) est obligatoire : un commerçant non immatriculé ne peut pas contracter (loi 04-08).",
    };
  }
  if (!party.representative.trim()) {
    return { error: "Le représentant signataire est obligatoire." };
  }
  if (!party.address.trim()) {
    return { error: "L'adresse du commerçant est obligatoire." };
  }
  const badPct = (v: number) => !Number.isFinite(v) || v < 0 || v > 50;
  if (
    badPct(terms.commission_cash_pct) ||
    badPct(terms.commission_online_pct)
  ) {
    return { error: "Taux de commission invalide (0 à 50 %)." };
  }
  if (!terms.effective_date) {
    return { error: "La date d'effet est obligatoire." };
  }
  if (terms.duration_type === "determinee" && !terms.duration_months) {
    return { error: "Indiquez la durée (mois) du contrat à durée déterminée." };
  }
  if (terms.equipment.provided) {
    const items = terms.equipment.items.filter((i) => i.label.trim());
    if (items.length === 0) {
      return {
        error:
          "Matériel coché mais liste vide : ajoutez au moins un équipement ou décochez.",
      };
    }
    terms.equipment.items = items;
  } else {
    terms.equipment.items = [];
    terms.equipment.return_required = false;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("merchant_contracts" as never)
    .insert({
      merchant_id: payload.merchant_id,
      party,
      terms,
      notes: payload.notes.trim() || null,
    } as never)
    .select("id")
    .single();
  if (error) return { error: `Création impossible : ${error.message}` };

  revalidatePath(PATH);
  return { id: (data as { id: string }).id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Traçabilité : upload du contrat SIGNÉ (scan PDF ou photo) → statut « signé »
// ─────────────────────────────────────────────────────────────────────────────
export async function uploadSignedContract(
  _prev: ContractActionState,
  formData: FormData
): Promise<ContractActionState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const contractId = String(formData.get("contract_id") ?? "");
  if (!contractId) return { error: "Contrat introuvable." };

  const checked = await validateUploadedFile(formData.get("file"), {
    kind: "image-pdf",
    maxBytes: 15 * MB,
  });
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = `${contractId}/signe-${Date.now()}.${checked.ext}`;
  const { error: upErr } = await supabase.storage
    .from("merchant-contracts")
    .upload(path, checked.bytes, { contentType: checked.mime });
  if (upErr) return { error: `Upload impossible : ${upErr.message}` };

  const { error } = await supabase
    .from("merchant_contracts" as never)
    .update({
      status: "signed",
      signed_at: new Date().toISOString(),
      signed_by: user?.id ?? null,
      signed_file_path: path,
    } as never)
    .eq("id", contractId);
  if (error) return { error: `Mise à jour impossible : ${error.message}` };

  revalidatePath(PATH);
  return { success: "Contrat signé archivé — traçabilité enregistrée." };
}

/** URL signée temporaire vers le scan du contrat signé (bucket privé). */
export async function getSignedContractUrl(
  contractId: string
): Promise<{ error?: string; url?: string }> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("merchant_contracts" as never)
    .select("signed_file_path")
    .eq("id", contractId)
    .maybeSingle();
  const p = (row as { signed_file_path: string | null } | null)
    ?.signed_file_path;
  if (!p) return { error: "Aucun scan signé archivé pour ce contrat." };
  const { data, error } = await supabase.storage
    .from("merchant-contracts")
    .createSignedUrl(p, 600);
  if (error || !data?.signedUrl) return { error: "Lien indisponible." };
  return { url: data.signedUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Résiliation + notes de suivi
// ─────────────────────────────────────────────────────────────────────────────
export async function terminateContract(
  contractId: string,
  reason: string
): Promise<ContractActionState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("merchant_contracts" as never)
    .select("notes")
    .eq("id", contractId)
    .maybeSingle();
  const prev = (row as { notes: string | null } | null)?.notes ?? "";
  const stamp = new Date().toISOString().slice(0, 10);
  const note = reason.trim()
    ? `${prev ? `${prev}\n` : ""}[${stamp}] Résiliation : ${reason.trim()}`
    : prev;
  const { error } = await supabase
    .from("merchant_contracts" as never)
    .update({
      status: "terminated",
      terminated_at: new Date().toISOString(),
      notes: note || null,
    } as never)
    .eq("id", contractId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: "Contrat résilié." };
}

export async function saveContractNotes(
  contractId: string,
  notes: string
): Promise<ContractActionState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("merchant_contracts" as never)
    .update({ notes: notes.trim() || null } as never)
    .eq("id", contractId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: "Notes enregistrées." };
}
