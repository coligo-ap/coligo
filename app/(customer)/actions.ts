"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  customerLoginSchema,
  customerSignupSchema,
  normalizeAlgerianPhone,
} from "@/lib/validation/customer-auth";
import { firstZodError } from "@/lib/validation/auth";
import {
  listPublicMerchants,
  type PublicMerchant,
} from "@/lib/data/merchants-public";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";

export type CustomerAuthState = {
  error?: string;
  success?: string;
};

/**
 * Connexion CLIENT — email + mot de passe.
 * Si le compte appartient à un commerçant (rangée dans `merchants`), on le
 * renvoie vers son espace pro pour éviter la confusion.
 */
export async function customerLogin(
  _prev: CustomerAuthState,
  formData: FormData
): Promise<CustomerAuthState> {
  const parsed = customerLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Email ou mot de passe incorrect" };
    }
    if (error.message.includes("Email not confirmed")) {
      return { error: "Confirme d'abord ton email avant de te connecter." };
    }
    return { error: error.message };
  }

  // Si l'user est en réalité un MARCHAND → redirige vers son espace pro.
  const userId = data.user?.id;
  if (userId) {
    const { data: merchant } = await supabase
      .from("merchants")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (merchant) {
      revalidatePath("/", "layout");
      redirect("/dashboard");
    }
  }

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Inscription CLIENT — crée auth.users + ligne `customers`.
 * Téléphone obligatoire (le commerçant en a besoin pour les commandes).
 */
export async function customerSignup(
  _prev: CustomerAuthState,
  formData: FormData
): Promise<CustomerAuthState> {
  const parsed = customerSignupSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { role: "customer", full_name: parsed.data.full_name },
    },
  });
  if (error) {
    if (error.message.includes("already registered")) {
      return { error: "Un compte existe déjà avec cet email." };
    }
    return { error: error.message };
  }
  if (!data.user) {
    return {
      error: "Inscription créée — vérifie ta boîte email pour confirmer.",
    };
  }

  // Bloque les commerçants qui essaient de s'inscrire en client (trigger DB
  // fait aussi le check, on intercepte avant pour un message clair).
  const { data: existingMerchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (existingMerchant) {
    return {
      error:
        "Ce compte est déjà un commerçant — utilise commercant.coligo.app.",
    };
  }

  const phoneE164 = normalizeAlgerianPhone(parsed.data.phone);
  const { error: insErr } = await supabase.from("customers").insert({
    user_id: data.user.id,
    full_name: parsed.data.full_name,
    phone: phoneE164,
    email: parsed.data.email,
  });
  if (insErr) {
    return { error: `Création du profil client : ${insErr.message}` };
  }

  // Si Supabase a déjà créé une session (confirm email OFF), on redirige.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/");
  }

  return {
    success:
      "Inscription validée — vérifie ta boîte email pour confirmer ton compte.",
  };
}

/**
 * Liste les commerces filtrés par zone (wilaya + commune optionnelle).
 * Appelée par le composant client `MerchantsByZone` après chaque changement
 * de zone côté navigateur.
 */
export async function fetchMerchantsForZone(input: {
  wilaya_code: string | null;
  commune: string | null;
  q?: string | null;
  category?: string | null;
}): Promise<PublicMerchant[]> {
  return listPublicMerchants({
    wilaya_code: input.wilaya_code,
    commune: input.commune,
    q: input.q,
    category: input.category,
    limit: 60,
  });
}

// =============================================================================
// Reverse-geocoding GPS → wilaya/commune algériens via Nominatim (OSM).
// =============================================================================
// On déchiffre l'adresse renvoyée par Nominatim et on tente un MATCH dans nos
// listes locales (`WILAYAS` + `COMMUNES_BY_WILAYA`). Si le match échoue, on
// renvoie au moins le libellé brut (`raw_locality`) pour info, mais sans code
// — l'UI proposera alors le formulaire manuel.

type ReverseGeocodeResult = {
  ok: boolean;
  wilaya_code?: string | null;
  wilaya_name?: string | null;
  commune?: string | null;
  /** Libellé "Commune · Wilaya" prêt à afficher. */
  display?: string | null;
  /** Brut OSM (pour debug / fallback). */
  raw_locality?: string | null;
  error?: string;
};

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findWilayaByName(name: string): { code: string; name: string } | null {
  const target = normalizeForMatch(name);
  if (!target) return null;
  const exact = WILAYAS.find((w) => normalizeForMatch(w.name) === target);
  if (exact) return { code: exact.code, name: exact.name };
  const partial = WILAYAS.find((w) => {
    const n = normalizeForMatch(w.name);
    return n.includes(target) || target.includes(n);
  });
  return partial ? { code: partial.code, name: partial.name } : null;
}

function findCommuneIn(
  wilayaCode: string,
  candidates: string[]
): string | null {
  const list = getCommunes(wilayaCode);
  if (list.length === 0) return null;
  const normList = list.map((c) => ({ raw: c, norm: normalizeForMatch(c) }));
  for (const cand of candidates) {
    const t = normalizeForMatch(cand);
    if (!t) continue;
    const exact = normList.find((c) => c.norm === t);
    if (exact) return exact.raw;
  }
  for (const cand of candidates) {
    const t = normalizeForMatch(cand);
    if (!t) continue;
    const partial = normList.find(
      (c) => c.norm.includes(t) || t.includes(c.norm)
    );
    if (partial) return partial.raw;
  }
  return null;
}

export async function reverseGeocode(input: {
  latitude: number;
  longitude: number;
}): Promise<ReverseGeocodeResult> {
  const { latitude, longitude } = input;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    Number.isNaN(latitude) ||
    Number.isNaN(longitude)
  ) {
    return { ok: false, error: "Coordonnées invalides." };
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("accept-language", "fr");
  url.searchParams.set("zoom", "12");
  url.searchParams.set("addressdetails", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        // Nominatim exige un User-Agent identifiant l'app.
        "User-Agent": "Coligo/0.3 (contact: dev@coligo.app)",
        Accept: "application/json",
      },
      // Garde les réponses en cache 10 min côté Next pour rester gentil avec
      // l'API publique gratuite.
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      return { ok: false, error: `Géocodage indisponible (${res.status}).` };
    }
    const data = (await res.json()) as {
      address?: Record<string, string | undefined>;
      display_name?: string;
    };
    const addr = data.address ?? {};

    // Filtre Algérie : si on est hors DZ, on n'essaie pas de matcher.
    const cc = (addr.country_code ?? "").toLowerCase();
    if (cc && cc !== "dz") {
      return {
        ok: false,
        error: "Position détectée hors Algérie.",
        raw_locality: data.display_name ?? null,
      };
    }

    // Wilaya = state Nominatim (ex: "Alger", "Oran"). Parfois "region".
    const stateRaw = addr.state ?? addr.region ?? "";
    const wilaya = stateRaw ? findWilayaByName(stateRaw) : null;

    // Commune : on essaie plusieurs champs OSM, dans l'ordre de pertinence.
    const localityCandidates = [
      addr.city,
      addr.town,
      addr.municipality,
      addr.village,
      addr.suburb,
      addr.county,
      addr.city_district,
      addr.neighbourhood,
    ].filter((x): x is string => !!x);

    const commune = wilaya
      ? findCommuneIn(wilaya.code, localityCandidates)
      : null;

    const rawLocality = localityCandidates[0] ?? null;
    const display =
      commune && wilaya
        ? `${commune} · ${wilaya.name}`
        : wilaya
          ? wilaya.name
          : rawLocality;

    return {
      ok: true,
      wilaya_code: wilaya?.code ?? null,
      wilaya_name: wilaya?.name ?? null,
      commune,
      display,
      raw_locality: rawLocality,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Géocodage indisponible.",
    };
  }
}

/** Déconnexion client (utilisable depuis n'importe quelle page client). */
export async function customerLogout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Met à jour la localisation préférée du client connecté. Si l'utilisateur
 * n'a pas de compte (anon), no-op silencieux.
 */
export async function updateCustomerLocation(input: {
  wilaya_code: string | null;
  commune: string | null;
  latitude: number | null;
  longitude: number | null;
}): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true };
  const { error } = await supabase
    .from("customers")
    .update({
      default_wilaya_code: input.wilaya_code,
      default_commune: input.commune,
      latitude: input.latitude,
      longitude: input.longitude,
    })
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}
