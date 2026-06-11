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
  getPromoLabelsByMerchant,
  type PublicMerchant,
  type PromoLabel,
} from "@/lib/data/merchants-public";
import {
  searchProductsInZone,
  type ProductSearchOutcome,
} from "@/lib/data/product-search";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";

export type CustomerAuthState = {
  error?: string;
  success?: string;
};

/**
 * Whitelist : un `next` valide doit être une URL RELATIVE à l'app commençant
 * par `/` (jamais `//`, jamais `http://...`) pour éviter l'open-redirect.
 */
function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

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

  // Retour vers `next` si fourni (panier intact survit naturellement via le
  // localStorage côté navigateur — voir prompt 16).
  const next = safeNextPath(formData.get("next"));
  revalidatePath("/", "layout");
  redirect(next);
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

  // Si Supabase a déjà créé une session (confirm email OFF), on redirige
  // vers `next` (panier intact côté navigateur — prompt 16).
  if (data.session) {
    const next = safeNextPath(formData.get("next"));
    revalidatePath("/", "layout");
    redirect(next);
  }

  return {
    success:
      "Inscription validée — vérifie ta boîte email pour confirmer ton compte.",
  };
}

/**
 * Liste les commerces filtrés par zone + recherche/catégorie/tri.
 * Appelée par le composant client `MarketplaceView` (home) après chaque
 * changement de zone OU de filtre de recherche.
 */
export async function fetchMerchantsForZone(input: {
  wilaya_code: string | null;
  commune: string | null;
  q?: string | null;
  category?: string | null;
  sort?: "name" | "min_order" | null;
}): Promise<PublicMerchant[]> {
  return listPublicMerchants({
    wilaya_code: input.wilaya_code,
    commune: input.commune,
    q: input.q,
    category: input.category,
    sort: input.sort === "min_order" ? "min_order" : "name",
    limit: 60,
  });
}

/**
 * Étiquettes de promo (− %, code, offre) par commerçant — pour mettre en avant
 * les promotions sur les cartes après un refetch de zone côté client.
 */
export async function fetchPromoLabels(
  merchantIds: string[]
): Promise<Record<string, PromoLabel>> {
  if (merchantIds.length === 0) return {};
  return getPromoLabelsByMerchant(merchantIds);
}

/**
 * Recherche par PRODUIT (volet 2). Renvoie les commerçants de la zone qui ont
 * le produit (ou un tag/catégorie/nom correspondant), groupés avec leurs
 * produits trouvés. Le filtre dur (fermé/hors-zone) + le tri par pilule sont
 * appliqués côté client à partir des champs commerçant complets.
 */
export async function searchProducts(input: {
  q: string;
  wilaya_code: string | null;
  commune: string | null;
}): Promise<ProductSearchOutcome> {
  return searchProductsInZone({
    q: input.q,
    wilaya_code: input.wilaya_code,
    commune: input.commune,
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
  /** Libellé précis (lieu/rue + commune) — pour Drive ; défaut = zone. */
  precise?: boolean;
}): Promise<ReverseGeocodeResult> {
  const { latitude, longitude, precise } = input;
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
  url.searchParams.set("zoom", precise ? "16" : "12");
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
    // Libellé court et lisible : « lieu/quartier, Commune » en mode précis,
    // sinon « Commune · Wilaya » (zone). Jamais l'adresse complète Nominatim.
    const detail = precise
      ? [addr.amenity, addr.road, addr.neighbourhood, addr.suburb].find(
          (x): x is string => !!x
        )
      : undefined;
    const locality = commune ?? rawLocality ?? wilaya?.name ?? null;
    const display =
      detail && locality && detail !== locality
        ? `${detail}, ${locality}`
        : commune && wilaya
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

// Recherche d'adresse HYBRIDE — sert la barre de recherche des cartes :
//   1. Gazetteer local `geo_places` (GeoNames + OSM + ajouts manuels, RPC
//      search_geo_places) : tolérant aux variantes de translittération des
//      toponymes algériens (« Lekhmisse » ≈ « Souk El Khemis ») + biais de
//      proximité quand la position est fournie.
//   2. Photon (komoot, données OSM, gratuit) : rues/POI + recherche floue.
//      Fallback Nominatim si Photon est indisponible.
// Les deux tournent en parallèle ; fusion dédupliquée, gazetteer sûr d'abord.
export type GeocodeSearchResult =
  | {
      ok: true;
      results: {
        display: string;
        secondary?: string;
        lat: number;
        lng: number;
      }[];
    }
  | { ok: false; error: string };

type GeoHit = {
  display: string;
  secondary?: string;
  lat: number;
  lng: number;
};

// Algérie entière (Photon n'a pas de filtre pays → bbox + countrycode).
const DZ_BBOX = "-8.7,18.9,12.1,37.3";

/** Clé de dédup : nom replié (minuscules sans accents/ponctuation) + ~1 km. */
function geoDedupeKey(r: GeoHit): string {
  const norm = r.display
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return `${norm}|${r.lat.toFixed(2)}|${r.lng.toFixed(2)}`;
}

/** Gazetteer local : RPC search_geo_places (échec silencieux → []). */
async function searchLocalGazetteer(
  q: string,
  lat?: number,
  lng?: number
): Promise<(GeoHit & { score: number })[]> {
  try {
    const supabase = await createClient();
    // ⚠️ Toujours .bind(supabase) — extraire rpc sans bind casse this.rest.
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    const { data, error } = await rpc("search_geo_places", {
      p_q: q,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
      p_limit: 6,
    });
    if (error || !data) return [];
    return (
      data as {
        name: string;
        wilaya: string | null;
        lat: number;
        lng: number;
        score: number;
      }[]
    ).map((d) => ({
      display: d.name,
      secondary: d.wilaya ?? undefined,
      lat: d.lat,
      lng: d.lng,
      score: d.score,
    }));
  } catch {
    return [];
  }
}

/** Photon (komoot) : recherche floue OSM, biaisée position. */
async function searchPhoton(
  q: string,
  lat?: number,
  lng?: number
): Promise<GeoHit[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "fr");
  url.searchParams.set("bbox", DZ_BBOX);
  if (lat !== undefined && lng !== undefined) {
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as {
    features?: {
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, string | undefined>;
    }[];
  };
  return (data.features ?? [])
    .map((f) => {
      const p = f.properties ?? {};
      const [lon2, lat2] = f.geometry?.coordinates ?? [];
      const main = (p.name ?? "").trim();
      const city = p.city ?? p.county ?? "";
      const area = [p.district, p.suburb].find(
        (x): x is string => !!x && x !== main && x !== city
      );
      return {
        display: city && city !== main ? `${main}, ${city}` : main,
        secondary: [area, p.state].filter(Boolean).join(" · ") || undefined,
        lat: Number(lat2),
        lng: Number(lon2),
        countrycode: p.countrycode,
      };
    })
    .filter(
      (r) =>
        r.display &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng) &&
        (r.countrycode ?? "DZ").toUpperCase() === "DZ"
    )
    .map(({ countrycode: _cc, ...r }) => r);
}

/** Nominatim : fallback si Photon est indisponible. */
async function searchNominatim(q: string): Promise<GeoHit[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("countrycodes", "dz");
  url.searchParams.set("accept-language", "fr");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");
  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Coligo/0.3 (contact: dev@coligo.app)",
      Accept: "application/json",
    },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as {
    display_name?: string;
    name?: string;
    lat?: string;
    lon?: string;
    address?: Record<string, string | undefined>;
  }[];
  return (data ?? [])
    .map((d) => {
      const a = d.address ?? {};
      const main =
        (d.name ?? "").trim() ||
        (d.display_name ?? "").split(",")[0]?.trim() ||
        "";
      const city =
        a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? "";
      const area = [a.neighbourhood, a.suburb].find(
        (x): x is string => !!x && x !== main && x !== city
      );
      return {
        display: city && city !== main ? `${main}, ${city}` : main,
        secondary: [area, a.state].filter(Boolean).join(" · ") || undefined,
        lat: Number(d.lat),
        lng: Number(d.lon),
      };
    })
    .filter(
      (r) => r.display && Number.isFinite(r.lat) && Number.isFinite(r.lng)
    );
}

export async function geocodeSearch(input: {
  q: string;
  lat?: number;
  lng?: number;
}): Promise<GeocodeSearchResult> {
  const q = (input.q ?? "").trim();
  if (q.length < 3) return { ok: true, results: [] };
  const lat = Number.isFinite(input.lat) ? input.lat : undefined;
  const lng = Number.isFinite(input.lng) ? input.lng : undefined;

  const [local, remote] = await Promise.all([
    searchLocalGazetteer(q, lat, lng),
    searchPhoton(q, lat, lng).catch(() => searchNominatim(q).catch(() => [])),
  ]);

  // Fusion : gazetteer confiant (score ≥ 0.5) d'abord — c'est lui qui comprend
  // les graphies locales — puis rues/POI Photon, puis le reste du gazetteer.
  const confident = local.filter((r) => r.score >= 0.5);
  const weak = local.filter((r) => r.score < 0.5);
  const seen = new Set<string>();
  const results: GeoHit[] = [];
  for (const r of [...confident, ...remote, ...weak]) {
    const k = geoDedupeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    results.push({
      display: r.display,
      secondary: r.secondary,
      lat: r.lat,
      lng: r.lng,
    });
    if (results.length >= 8) break;
  }

  if (results.length === 0) {
    // Recherche manquée → notée pour enrichissement manuel du gazetteer
    // (le super-admin voit ce que les clients cherchent en vain).
    try {
      const supabase = await createClient();
      const from = supabase.from.bind(supabase) as unknown as (t: string) => {
        insert: (v: Record<string, unknown>) => PromiseLike<unknown>;
      };
      await from("geo_search_misses").insert({
        q,
        lat: lat ?? null,
        lng: lng ?? null,
      });
    } catch {
      /* best effort */
    }
  }

  return { ok: true, results };
}

// Itinéraire routier réel (OSRM public) : distance ET durée fiables, au lieu
// du vol d'oiseau. Durée ×1,2 (circulation urbaine DZ). Cache 1 h par paire de
// points arrondis (~10 m) pour rester gentil avec l'API gratuite.
export type RouteEstimateResult =
  | {
      ok: true;
      distance_km: number;
      duration_min: number;
      /** Tracé simplifié de la route (pour dessin sur la carte). */
      geometry?: { lat: number; lng: number }[];
    }
  | { ok: false; error: string };

export async function routeEstimate(input: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}): Promise<RouteEstimateResult> {
  const { from, to } = input;
  const pts = [from.lat, from.lng, to.lat, to.lng];
  if (pts.some((v) => typeof v !== "number" || Number.isNaN(v))) {
    return { ok: false, error: "Coordonnées invalides." };
  }
  const r4 = (v: number) => v.toFixed(4);
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${r4(from.lng)},${r4(from.lat)};${r4(to.lng)},${r4(to.lat)}` +
    `?overview=simplified&geometries=geojson&alternatives=false&steps=false`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Coligo/0.3 (contact: dev@coligo.app)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok)
      return { ok: false, error: `Itinéraire indisponible (${res.status}).` };
    const data = (await res.json()) as {
      code?: string;
      routes?: {
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
      }[];
    };
    const route = data.code === "Ok" ? data.routes?.[0] : null;
    if (!route?.distance || !route?.duration) {
      return { ok: false, error: "Itinéraire introuvable." };
    }
    const geometry = (route.geometry?.coordinates ?? [])
      .filter(
        (c) =>
          Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])
      )
      .map(([lng, lat]) => ({ lat, lng }));
    return {
      ok: true,
      distance_km: Math.max(0.1, Number((route.distance / 1000).toFixed(2))),
      duration_min: Math.max(2, Math.round((route.duration / 60) * 1.2)),
      geometry: geometry.length > 1 ? geometry : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Itinéraire indisponible.",
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

/**
 * Bascule le favori d'un commerce pour le client connecté (toggle).
 * Renvoie l'état FINAL (`favorite`) pour que le cœur se synchronise.
 *  - `error: "auth"` → l'appelant doit rediriger vers la connexion.
 * La RLS garantit qu'on ne touche QUE les favoris du client courant.
 */
export async function toggleFavorite(
  merchantId: string
): Promise<{ favorite: boolean; error?: "auth" | "other" }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { favorite: false, error: "auth" };

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return { favorite: false, error: "auth" };

  const { data: existing } = await supabase
    .from("customer_favorites")
    .select("id")
    .eq("customer_id", customer.id)
    .eq("merchant_id", merchantId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("customer_favorites")
      .delete()
      .eq("id", existing.id);
    if (error) return { favorite: true, error: "other" };
    revalidatePath("/favoris");
    return { favorite: false };
  }

  const { error } = await supabase
    .from("customer_favorites")
    .insert({ customer_id: customer.id, merchant_id: merchantId });
  if (error) return { favorite: false, error: "other" };
  revalidatePath("/favoris");
  return { favorite: true };
}
