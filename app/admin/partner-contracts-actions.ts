"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { validateUploadedFile, MB } from "@/lib/security/file-validation";
import {
  PARTNER_KIND_META,
  type PartnerKind,
  type PartnerParty,
  type PartnerTerms,
} from "@/lib/types/partner-contract";

// Server actions des contrats livreurs/chauffeurs (mig 0344). Le gate admin
// dépend du type de partenaire : livreur → domaine « livraison », chauffeur →
// « drive ». Les RLS de partner_contracts appliquent la même règle en base.

const pathFor = (kind: PartnerKind) =>
  kind === "driver" ? "/admin/drivers/contrats" : "/admin/chauffeurs/contrats";

export type PartnerContractActionState = { error?: string; success?: string };

// ─────────────────────────────────────────────────────────────────────────────
// Pré-remplissage depuis un livreur / chauffeur inscrit
// ─────────────────────────────────────────────────────────────────────────────
export async function getPartnerContractPrefill(
  kind: PartnerKind,
  partnerId: string
): Promise<{ error?: string; party?: Partial<PartnerParty> }> {
  if (!(await adminCan(PARTNER_KIND_META[kind].adminDomain))) {
    return { error: "Accès refusé." };
  }
  // Lecture service_role (les RLS de drivers/chauffeurs ne couvrent pas la
  // lecture admin) — self-guardée par le gate adminCan ci-dessus.
  const admin = createAdminClient();
  const table = kind === "driver" ? "drivers" : "chauffeurs";
  const { data } = await admin
    .from(table as never)
    .select("*")
    .eq("id", partnerId)
    .maybeSingle();
  const r = data as Record<string, unknown> | null;
  if (!r) return { error: "Partenaire introuvable." };

  const s = (v: unknown) => (typeof v === "string" ? v : "");

  if (kind === "driver") {
    return {
      party: {
        full_name: s(r.full_name),
        id_number: s(r.id_card_number) || s(r.national_id_number),
        address: s(r.address),
        wilaya: s(r.wilaya),
        phone: s(r.phone),
        email: s(r.email),
        vehicle_type: s(r.vehicle_type) || s(r.vehicle_label),
        vehicle_brand: s(r.vehicle_brand),
        vehicle_model: s(r.vehicle_model),
        vehicle_plate: s(r.vehicle_plate),
      },
    };
  }
  return {
    party: {
      full_name: s(r.full_name),
      address: s(r.home_addr_text),
      wilaya: s(r.wilaya) || s(r.city),
      phone: s(r.phone),
      email: s(r.email),
      vehicle_type: s(r.gamme),
      vehicle_brand: s(r.vehicle_make),
      vehicle_model: s(r.vehicle_model),
      vehicle_plate: s(r.vehicle_plate),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Émission
// ─────────────────────────────────────────────────────────────────────────────
export async function createPartnerContract(payload: {
  kind: PartnerKind;
  partner_id: string | null;
  party: PartnerParty;
  terms: PartnerTerms;
  notes: string;
}): Promise<{ error?: string; id?: string }> {
  const { kind, party, terms } = payload;
  if (!(await adminCan(PARTNER_KIND_META[kind].adminDomain))) {
    return { error: "Accès refusé." };
  }

  if (!party.full_name.trim()) {
    return { error: "Le nom complet du partenaire est obligatoire." };
  }
  if (!party.id_number.trim()) {
    return { error: "Le n° de pièce d'identité est obligatoire." };
  }
  if (!party.license_number.trim()) {
    return { error: "Le n° de permis de conduire est obligatoire." };
  }
  if (!party.address.trim()) {
    return { error: "L'adresse du partenaire est obligatoire." };
  }
  if (!party.vehicle_plate.trim()) {
    return { error: "L'immatriculation du véhicule est obligatoire." };
  }
  if (
    !Number.isFinite(terms.fee_pct) ||
    terms.fee_pct < 0 ||
    terms.fee_pct > 50
  ) {
    return { error: "Frais de service invalides (0 à 50 %)." };
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
    .from("partner_contracts" as never)
    .insert({
      partner_kind: kind,
      partner_id: payload.partner_id,
      party,
      terms,
      notes: payload.notes.trim() || null,
    } as never)
    .select("id")
    .single();
  if (error) return { error: `Création impossible : ${error.message}` };

  revalidatePath(pathFor(kind));
  return { id: (data as { id: string }).id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan signé, lien, résiliation, notes — la lecture du contrat passe par les
// RLS (domaine du kind) : une ligne introuvable = pas le droit ou inexistante.
// ─────────────────────────────────────────────────────────────────────────────
async function loadContract(contractId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("partner_contracts" as never)
    .select("id, partner_kind, notes, signed_file_path")
    .eq("id", contractId)
    .maybeSingle();
  return {
    supabase,
    row: data as {
      id: string;
      partner_kind: PartnerKind;
      notes: string | null;
      signed_file_path: string | null;
    } | null,
  };
}

export async function uploadSignedPartnerContract(
  _prev: PartnerContractActionState,
  formData: FormData
): Promise<PartnerContractActionState> {
  const contractId = String(formData.get("contract_id") ?? "");
  const { supabase, row } = await loadContract(contractId);
  if (!row) return { error: "Contrat introuvable ou accès refusé." };

  const checked = await validateUploadedFile(formData.get("file"), {
    kind: "image-pdf",
    maxBytes: 15 * MB,
  });
  if (!checked.ok) return { error: checked.error };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = `${row.id}/signe-${Date.now()}.${checked.ext}`;
  const { error: upErr } = await supabase.storage
    .from("partner-contracts")
    .upload(path, checked.bytes, { contentType: checked.mime });
  if (upErr) return { error: `Upload impossible : ${upErr.message}` };

  const { error } = await supabase
    .from("partner_contracts" as never)
    .update({
      status: "signed",
      signed_at: new Date().toISOString(),
      signed_by: user?.id ?? null,
      signed_file_path: path,
    } as never)
    .eq("id", row.id);
  if (error) return { error: `Mise à jour impossible : ${error.message}` };

  revalidatePath(pathFor(row.partner_kind));
  return { success: "Contrat signé archivé — traçabilité enregistrée." };
}

export async function getSignedPartnerContractUrl(
  contractId: string
): Promise<{ error?: string; url?: string }> {
  const { supabase, row } = await loadContract(contractId);
  if (!row) return { error: "Contrat introuvable ou accès refusé." };
  if (!row.signed_file_path) {
    return { error: "Aucun scan signé archivé pour ce contrat." };
  }
  const { data, error } = await supabase.storage
    .from("partner-contracts")
    .createSignedUrl(row.signed_file_path, 600);
  if (error || !data?.signedUrl) return { error: "Lien indisponible." };
  return { url: data.signedUrl };
}

export async function terminatePartnerContract(
  contractId: string,
  reason: string
): Promise<PartnerContractActionState> {
  const { supabase, row } = await loadContract(contractId);
  if (!row) return { error: "Contrat introuvable ou accès refusé." };
  const stamp = new Date().toISOString().slice(0, 10);
  const note = reason.trim()
    ? `${row.notes ? `${row.notes}\n` : ""}[${stamp}] Résiliation : ${reason.trim()}`
    : row.notes;
  const { error } = await supabase
    .from("partner_contracts" as never)
    .update({
      status: "terminated",
      terminated_at: new Date().toISOString(),
      notes: note || null,
    } as never)
    .eq("id", row.id);
  if (error) return { error: error.message };
  revalidatePath(pathFor(row.partner_kind));
  return { success: "Contrat résilié." };
}

export async function savePartnerContractNotes(
  contractId: string,
  notes: string
): Promise<PartnerContractActionState> {
  const { supabase, row } = await loadContract(contractId);
  if (!row) return { error: "Contrat introuvable ou accès refusé." };
  const { error } = await supabase
    .from("partner_contracts" as never)
    .update({ notes: notes.trim() || null } as never)
    .eq("id", row.id);
  if (error) return { error: error.message };
  revalidatePath(pathFor(row.partner_kind));
  return { success: "Notes enregistrées." };
}
