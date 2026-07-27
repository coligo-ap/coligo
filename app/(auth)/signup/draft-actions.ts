"use server";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// Brouillons d'inscription commerçant (mig 0414) — enregistrés à CHAQUE étape
// du wizard /signup pour que le super-admin puisse recontacter les commerçants
// qui n'ont pas finalisé. Table verrouillée RLS sans policy → service_role
// uniquement, d'où ces actions serveur. Écriture fire-and-forget côté client :
// aucune erreur ici ne doit jamais bloquer l'inscription elle-même.
// =============================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SignupDraftInput = {
  /** Jeton client (localStorage) identifiant LE brouillon à reprendre. */
  key: string;
  source: "email" | "google";
  /** Étape atteinte (1-based) — le serveur garde le MAX. */
  step: number;
  stepsTotal: number;
  merchantName?: string;
  managerName?: string;
  phone?: string;
  email?: string;
  categories?: string[];
  wilayaCode?: string;
  city?: string;
  address?: string;
  latitude?: string;
  longitude?: string;
};

/** Trim + borne une chaîne libre, ou undefined si vide/absente. */
function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, max);
  return s ? s : undefined;
}

type DraftsTable = {
  select: (c: string) => {
    eq: (
      c: string,
      v: string
    ) => {
      maybeSingle: () => Promise<{
        data: { id: string; status: string; step_reached: number } | null;
      }>;
    };
  };
  insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
  update: (v: Record<string, unknown>) => {
    eq: (c: string, v: string) => Promise<{ error: unknown }>;
  };
};

/** Accès castée à la table (hors types générés). */
function draftsTable(): DraftsTable {
  const admin = createAdminClient();
  // IMPORTANT : .bind(admin) — extraire from sans binder casse this.rest.
  const from = admin.from.bind(admin) as unknown as (t: string) => DraftsTable;
  return from("merchant_signup_drafts");
}

/**
 * Enregistre (upsert par draft_key) le brouillon d'inscription. N'écrit QUE
 * les clés soumises non vides — jamais d'effacement d'une valeur déjà
 * enregistrée par une étape précédente. Renvoie la clé à conserver côté
 * client : une nouvelle clé est émise si l'ancienne pointe un brouillon déjà
 * finalisé/écarté (nouvelle inscription sur le même appareil).
 */
export async function saveSignupDraft(
  input: SignupDraftInput
): Promise<{ key: string }> {
  let key = UUID_RE.test(input.key ?? "") ? input.key.toLowerCase() : null;

  const step = Math.min(Math.max(Math.trunc(Number(input.step) || 1), 1), 9);
  const stepsTotal = Math.min(
    Math.max(Math.trunc(Number(input.stepsTotal) || 4), 1),
    9
  );

  // Patch = UNIQUEMENT les champs fournis (cf. piège « champ retiré = colonne
  // effacée » : on ne pose jamais null sur une clé absente).
  const patch: Record<string, unknown> = {};
  const merchantName = clean(input.merchantName, 120);
  const managerName = clean(input.managerName, 120);
  const email = clean(input.email, 160);
  const city = clean(input.city, 80);
  const address = clean(input.address, 200);
  const wilayaCode = clean(input.wilayaCode, 3);
  if (merchantName) patch.merchant_name = merchantName;
  if (managerName) patch.manager_name = managerName;
  if (city) patch.city = city;
  if (address) patch.address = address;
  if (wilayaCode && /^\d{1,3}$/.test(wilayaCode))
    patch.wilaya_code = wilayaCode;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) patch.email = email;

  // Téléphone : uniquement la forme canonique produite par PhoneField
  // (0XXXXXXXXX mobile DZ, ou E.164) — jamais une saisie ambiguë.
  const phone = clean(input.phone, 20);
  if (phone && (/^0[567]\d{8}$/.test(phone) || /^\+\d{8,15}$/.test(phone))) {
    patch.phone = phone;
  }

  if (Array.isArray(input.categories)) {
    const cats = input.categories
      .filter((c): c is string => typeof c === "string" && !!c.trim())
      .map((c) => c.trim().slice(0, 40))
      .slice(0, 8);
    if (cats.length > 0) patch.categories = cats;
  }

  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    input.latitude !== "" &&
    input.longitude !== ""
  ) {
    patch.latitude = lat;
    patch.longitude = lng;
  }

  const source = input.source === "google" ? "google" : "email";

  // Complétion Google : la session existe → email + user id fiables (serveur).
  if (source === "google") {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        patch.auth_user_id = user.id;
        if (user.email) patch.email = user.email;
      }
    } catch {
      /* session illisible → brouillon anonyme, tant pis */
    }
  }

  try {
    const table = draftsTable();
    const existing = key
      ? (
          await table
            .select("id,status,step_reached")
            .eq("draft_key", key)
            .maybeSingle()
        ).data
      : null;

    if (existing && existing.status === "in_progress") {
      await table
        .update({
          ...patch,
          step_reached: Math.max(step, existing.step_reached ?? 1),
          steps_total: stepsTotal,
          updated_at: new Date().toISOString(),
        })
        .eq("draft_key", key as string);
      return { key: key as string };
    }

    // Pas de brouillon (ou déjà finalisé/écarté) → nouvelle ligne, nouvelle clé.
    key = existing ? randomUUID() : (key ?? randomUUID());
    await table.insert({
      draft_key: key,
      source,
      step_reached: step,
      steps_total: stepsTotal,
      ...patch,
    });
    return { key };
  } catch {
    // Jamais bloquant pour l'inscription.
    return { key: key ?? randomUUID() };
  }
}

/**
 * Marque le brouillon comme finalisé (boutique créée) — appelé par les actions
 * `signup` / `completeSocialSignup` après succès. Best-effort silencieux.
 */
export async function markSignupDraftCompleted(
  draftKey: FormDataEntryValue | null
): Promise<void> {
  if (typeof draftKey !== "string" || !UUID_RE.test(draftKey)) return;
  try {
    await draftsTable()
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("draft_key", draftKey.toLowerCase());
  } catch {
    /* best-effort */
  }
}
