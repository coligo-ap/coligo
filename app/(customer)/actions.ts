"use server";

import { revalidatePath } from "next/cache";
import { markSignedOut } from "@/lib/auth/mark-signed-out";
import { clearMyDeviceTokens } from "@/lib/notifications/device-tokens";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentCustomer } from "@/lib/auth/customer";
import {
  customerLoginSchema,
  customerSignupSchema,
  normalizeAlgerianPhone,
} from "@/lib/validation/customer-auth";
import { firstZodError } from "@/lib/validation/auth";
import {
  rateHit,
  logSecurityEvent,
  formatRetryDelay,
} from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request-context";
import {
  verifyTurnstileToken,
  honeypotTripped,
  TURNSTILE_FIELD,
} from "@/lib/security/turnstile";
import { attachReferralForNewCustomer } from "@/lib/referral/attach";
import {
  listPublicMerchants,
  getPromoLabelsByMerchant,
  type PublicMerchant,
  type PromoLabel,
} from "@/lib/data/merchants-public";
import { rankMerchantsIfUnified } from "@/lib/data/merchant-ranking";
import {
  searchProductsInZone,
  type ProductSearchOutcome,
} from "@/lib/data/product-search";
import {
  getActiveBanners,
  type BannerViewerLocation,
  type PromoBanner,
} from "@/lib/data/promo-banners";
import {
  getMyCashbackBalance,
  getMyTopupBalance,
} from "@/lib/customer/cashback";
import { getGeoConfig, type GeoConfig } from "@/lib/data/geo-config";
import { roadRoute } from "@/lib/drive/routing";
import { haversineKm } from "@/lib/delivery/distance";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";

export type CustomerAuthState = {
  error?: string;
  success?: string;
};

/**
 * Bannières promo visibles pour une POSITION donnée — utilisé côté client par
 * les visiteurs ANONYMES (position en localStorage, jamais envoyée au SSR) pour
 * voir aussi les bannières ciblées par zone qui les concernent. Public (la RPC
 * `active_banners_for` est SECURITY DEFINER + grant anon).
 */
export async function getBannersForLocation(
  loc: BannerViewerLocation
): Promise<PromoBanner[]> {
  return getActiveBanners(loc);
}

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

  // Cloisonnement des métiers : les comptes livreur/chauffeur (emails
  // synthétiques internes) ne se connectent JAMAIS ici. Chaque espace a sa
  // propre inscription — un livreur qui veut commander crée un compte CLIENT.
  const emailLc = parsed.data.email.toLowerCase();
  if (
    emailLc.endsWith("@drivers.coligo.local") ||
    emailLc.endsWith("@chauffeurs.coligo.local") ||
    emailLc.endsWith("@partners.coligo.local")
  ) {
    return { error: "Email ou mot de passe incorrect" };
  }

  // Anti-abus (mig 0452) : plafond par IP + verrou par identifiant qui ne
  // compte que les ÉCHECS (peek avant tentative, hit après échec).
  const loginIp = await getClientIp();
  const ipGate = await rateHit("login_ip", `customer:${loginIp}`, 30, 600);
  if (!ipGate.allowed) {
    await logSecurityEvent("rate_limited", {
      bucket: "login_ip",
      subject: "customer",
      path: "/se-connecter",
    });
    return {
      error: `Trop de tentatives. Réessaie dans ${formatRetryDelay(ipGate.retryAfterSeconds)}.`,
    };
  }
  const failGate = await rateHit(
    "login_fail",
    `customer:${emailLc}`,
    10,
    900,
    0
  );
  if (!failGate.allowed) {
    return {
      error: `Trop de tentatives pour ce compte. Réessaie dans ${formatRetryDelay(failGate.retryAfterSeconds)}.`,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      await rateHit("login_fail", `customer:${emailLc}`, 10, 900);
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

  // Les domaines internes livreur/chauffeur ne sont pas des emails de client.
  const signupEmailLc = parsed.data.email.toLowerCase();
  if (signupEmailLc.endsWith(".coligo.local")) {
    return { error: "Adresse email invalide." };
  }

  // ── Anti-bot / anti-abus (mig 0452) ────────────────────────────────────────
  // 1. Honeypot : champ invisible que seuls les robots remplissent.
  if (honeypotTripped(formData)) {
    await logSecurityEvent("honeypot", { path: "/inscription" });
    return { error: "Inscription impossible. Réessaie plus tard." };
  }
  // 2. Plafonds par IP — généreux (CGNAT mobile algérien : une IP publique est
  //    partagée par des milliers d'abonnés), mais fatals pour un script.
  const signupIp = await getClientIp();
  const [hourGate, dayGate] = await Promise.all([
    rateHit("signup_ip_h", signupIp, 20, 3600),
    rateHit("signup_ip_d", signupIp, 60, 86400),
  ]);
  if (!hourGate.allowed || !dayGate.allowed) {
    await logSecurityEvent("rate_limited", {
      bucket: "signup_ip",
      subject: "customer",
      path: "/inscription",
    });
    const retry = Math.max(
      hourGate.retryAfterSeconds,
      dayGate.retryAfterSeconds
    );
    return {
      error: `Trop d'inscriptions depuis ce réseau. Réessaie dans ${formatRetryDelay(retry)}.`,
    };
  }
  // 3. Captcha Turnstile (actif dès que les clés sont posées, sinon dormant).
  const captcha = await verifyTurnstileToken(
    formData.get(TURNSTILE_FIELD),
    signupIp
  );
  if (!captcha.ok) {
    return { error: "Vérification anti-robot échouée. Réessaie." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { role: "customer", full_name: parsed.data.full_name },
      captchaToken: captcha.token ?? undefined,
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
  const { data: created, error: insErr } = await supabase
    .from("customers")
    .insert({
      user_id: data.user.id,
      full_name: parsed.data.full_name,
      phone: phoneE164,
      email: parsed.data.email,
    })
    .select("id")
    .single();
  if (insErr) {
    return { error: `Création du profil client : ${insErr.message}` };
  }

  // Parrainage (champ du formulaire ou cookie /r/CODE) — best-effort : ne
  // bloque jamais l'inscription, toutes les règles sont dans la RPC.
  if (created?.id) {
    await attachReferralForNewCustomer(
      created.id,
      formData.get("referral_code") as string | null
    );
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
  /** Position COURANTE du client (GPS) → classement par proximité réelle. */
  latitude?: number | null;
  longitude?: number | null;
  q?: string | null;
  category?: string | null;
  sort?: "name" | "min_order" | null;
}): Promise<PublicMerchant[]> {
  const merchants = await listPublicMerchants({
    wilaya_code: input.wilaya_code,
    commune: input.commune,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    q: input.q,
    category: input.category,
    sort: input.sort === "min_order" ? "min_order" : "name",
    limit: 60,
  });

  // RANKING UNIFIÉ (mig 0261) : on reclasse par score composite pour que la
  // liste rafraîchie suive le MÊME ordre que le SSR. On NE touche PAS aux ordres
  // EXPLICITES de l'utilisateur : recherche texte (pertinence) et tri prix
  // (min_order) sont préservés tels quels. Le tri « mieux notés » reste appliqué
  // côté client (serverSort = name) → le reclassement composite est inoffensif.
  const isTextSearch = !!input.q?.trim();
  if (isTextSearch || input.sort === "min_order") return merchants;
  const { merchants: ranked } = await rankMerchantsIfUnified(merchants, {
    customer: {
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    },
  });
  return ranked;
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
 * Soldes des deux poches du client (cashback + Coligo Pay) en un seul appel.
 * Utilisé côté client par `WalletBalanceValue` (TanStack Query) pour afficher
 * INSTANTANÉMENT la valeur SSR puis la rafraîchir en silence, et la réutiliser
 * entre /compte ↔ /coligo-pay sans re-fetch (clé partagée). Ré-authentifié
 * côté serveur (RLS) à chaque appel → aucune fuite entre comptes.
 */
export async function fetchMyWalletBalances(): Promise<{
  cashback: number;
  topup: number;
}> {
  const [cashback, topup] = await Promise.all([
    getMyCashbackBalance(),
    getMyTopupBalance(),
  ]);
  return { cashback, topup };
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

/**
 * Reverse geocode INSTANTANÉ via le gazetteer LOCAL (geo_nearest_place, PostGIS
 * KNN, ~5-50 ms) : plus proche lieu de geo_places (~60k lieux DZ). Sert de repli
 * GARANTI quand Nominatim est lent/indispo, et de 1ʳᵉ réponse « optimiste » pour
 * que la position s'affiche TOUT DE SUITE au déplacement du repère. Best-effort.
 */
async function nearestGazetteerLabel(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    const { data, error } = await rpc("geo_nearest_place", {
      p_lat: lat,
      p_lng: lng,
    });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : null) as {
      name: string;
      wilaya: string | null;
    } | null;
    if (!row?.name) return null;
    const wilaya = row.wilaya ? findWilayaByName(row.wilaya) : null;
    return {
      ok: true,
      wilaya_code: wilaya?.code ?? null,
      wilaya_name: wilaya?.name ?? row.wilaya ?? null,
      commune: null,
      display: wilaya ? `${row.name} · ${wilaya.name}` : row.name,
      raw_locality: row.name,
    };
  } catch {
    return null;
  }
}

/**
 * Libellé INSTANTANÉ du lieu le plus proche (gazetteer local). Le client
 * l'appelle SANS debounce au déplacement du repère → la position s'affiche
 * immédiatement, puis `reverseGeocode` (précis) affine avec la rue.
 */
export async function nearestPlaceLabel(input: {
  latitude: number;
  longitude: number;
}): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    return { ok: false, error: "Coordonnées invalides." };
  }
  const g = await nearestGazetteerLabel(input.latitude, input.longitude);
  return g ?? { ok: false, error: "Lieu introuvable." };
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
    // TIMEOUT 2,5 s (AbortController) : Nominatim ne doit JAMAIS figer la
    // détection. Au-delà, on bascule sur le gazetteer local (instantané).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          // Nominatim exige un User-Agent identifiant l'app.
          "User-Agent": "Coligo/0.3 (contact: dev@coligo.app)",
          Accept: "application/json",
        },
        signal: controller.signal,
        // Garde les réponses en cache 10 min côté Next pour rester gentil avec
        // l'API publique gratuite.
        next: { revalidate: 600 },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // Indispo → repli gazetteer local (jamais d'échec sec).
      return (
        (await nearestGazetteerLabel(latitude, longitude)) ?? {
          ok: false,
          error: `Géocodage indisponible (${res.status}).`,
        }
      );
    }
    const data = (await res.json()) as {
      address?: Record<string, string | undefined>;
      display_name?: string;
    };
    const addr = data.address ?? {};

    // HORS ALGÉRIE : pas d'enrichissement wilaya/commune (la zone de service
    // reste l'Algérie), MAIS on renvoie tout de même un LIBELLÉ LISIBLE depuis
    // OpenStreetMap (rue / quartier, ville) — couverture mondiale — au lieu de
    // coordonnées GPS brutes. Le wilaya/commune null → pas de zone DZ associée
    // (l'enforcement de zone au checkout reste la source de vérité).
    const cc = (addr.country_code ?? "").toLowerCase();
    if (cc && cc !== "dz") {
      const detailX = precise
        ? [addr.amenity, addr.road, addr.neighbourhood, addr.suburb].find(
            (x): x is string => !!x
          )
        : undefined;
      const cityX =
        [
          addr.city,
          addr.town,
          addr.village,
          addr.municipality,
          addr.county,
          addr.suburb,
        ].find((x): x is string => !!x) ?? null;
      const displayX =
        detailX && cityX && detailX !== cityX
          ? `${detailX}, ${cityX}`
          : (detailX ?? cityX ?? data.display_name ?? null);
      return {
        ok: true,
        wilaya_code: null,
        wilaya_name: null,
        commune: null,
        display: displayX,
        raw_locality: cityX,
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
    // Timeout / abort / réseau → repli gazetteer local (instantané, jamais vide).
    return (
      (await nearestGazetteerLabel(latitude, longitude)) ?? {
        ok: false,
        error: err instanceof Error ? err.message : "Géocodage indisponible.",
      }
    );
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
        /** "merchant" = commerçant Coligo · "google" = résultat Google Places
         *  (distinct des cartes gratuites OSM, affiché en premier). */
        kind?: "merchant" | "google";
      }[];
    }
  | { ok: false; error: string };

type GeoHit = {
  display: string;
  secondary?: string;
  lat: number;
  lng: number;
  /** "merchant" = commerçant Coligo · "google" = résultat Google Places (vs
   *  lieu / POI des cartes gratuites OSM). */
  kind?: "merchant" | "google";
};

// Algérie entière (Photon n'a pas de filtre pays → bbox + countrycode).
const DZ_BBOX = "-8.7,18.9,12.1,37.3";

/** Clé de dédup : nom replié (minuscules sans accents/ponctuation) + ~1 km. */
function geoNorm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Doublon d'adresse ? On considère deux suggestions identiques si elles
 * pointent quasiment le MÊME POINT (~40 m) OU si elles portent le MÊME NOM à
 * moins de ~600 m — cas typique du même lieu renvoyé par plusieurs fournisseurs
 * (gazetteer + Photon + Nominatim + Google) avec un libellé/des coordonnées
 * légèrement différents. Évite d'afficher deux fois la même adresse.
 */
function geoIsDuplicate(r: GeoHit, accepted: GeoHit[]): boolean {
  const n = geoNorm(r.display);
  for (const a of accepted) {
    const km = haversineKm(
      { lat: a.lat, lng: a.lng },
      { lat: r.lat, lng: r.lng }
    );
    if (km < 0.04) return true;
    if (km < 0.6 && geoNorm(a.display) === n) return true;
  }
  return false;
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

// Libellé humain de la catégorie commerçant (pour le sous-titre du résultat).
const MERCHANT_CAT_FR: Record<string, string> = {
  restaurant: "Restaurant",
  fastfood: "Fast-food",
  pizzeria: "Pizzeria",
  cafe: "Café",
  coffee: "Café",
  pharmacie: "Pharmacie",
  pharmacy: "Pharmacie",
  parapharmacie: "Parapharmacie",
  boulangerie: "Boulangerie",
  bakery: "Boulangerie",
  patisserie: "Pâtisserie",
  alimentation: "Alimentation",
  grocery: "Alimentation",
  superette: "Supérette",
  boucherie: "Boucherie",
  shop: "Commerce",
  store: "Magasin",
  vetements: "Vêtements",
  electronique: "Électronique",
};

/** Commerces enregistrés : RPC search_merchants (échec silencieux → []). */
async function searchMerchants(
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
    const { data, error } = await rpc("search_merchants", {
      p_q: q,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
      p_limit: 6,
    });
    if (error || !data) return [];
    return (
      data as {
        id: string;
        name: string;
        category: string | null;
        commune: string | null;
        lat: number;
        lng: number;
        score: number;
      }[]
    ).map((d) => {
      const cat = d.category
        ? (MERCHANT_CAT_FR[d.category.toLowerCase()] ?? d.category)
        : "Commerce";
      return {
        display: d.name,
        secondary: [cat, d.commune].filter(Boolean).join(" · "),
        lat: d.lat,
        lng: d.lng,
        score: d.score,
        kind: "merchant" as const,
      };
    });
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

// Mots génériques (catégories / types de voie) : présents dans beaucoup de
// résultats, ils ne sont PAS distinctifs. Exclus du test de couverture — sinon
// « restaurant bejaia » déclencherait un appel payant pour rien.
const SEARCH_GENERIC = new Set([
  "restaurant",
  "resto",
  "restau",
  "cafe",
  "cafeteria",
  "pizzeria",
  "pizza",
  "fastfood",
  "snack",
  "glacier",
  "patisserie",
  "boulangerie",
  "boucherie",
  "alimentation",
  "superette",
  "supermarche",
  "epicerie",
  "pharmacie",
  "parapharmacie",
  "clinique",
  "hopital",
  "banque",
  "agence",
  "hotel",
  "auberge",
  "motel",
  "ecole",
  "lycee",
  "college",
  "universite",
  "magasin",
  "boutique",
  "centre",
  "commercial",
  "station",
  "essence",
  "gare",
  "mosquee",
  "marche",
  "souk",
  "place",
  "placette",
  "rue",
  "avenue",
  "boulevard",
  "chemin",
  "cite",
  "quartier",
  "lotissement",
  "residence",
  "ville",
  "wilaya",
  "commune",
  "daira",
  "nouvelle",
  "ancienne",
  "grand",
  "grande",
  "petit",
  "petite",
]);

// Plafonds Google Places (anti-dérapage) — désormais pilotés par /admin/config
// (clés geo : google_min_qlen, google_daily_global, google_daily_per_user,
// geocode_google_enabled). Lus via getGeoConfig() puis passés en paramètre.

/**
 * Fallback Google Places (New) — DERNIER RECOURS, payant donc verrouillé :
 *   • réservé aux clients connectés, longueur de requête min ;
 *   • cache 30 j (une recherche payée n'est jamais re-payée) ;
 *   • plafonds journaliers par client puis global (hard stop).
 * Sans clé `GOOGLE_MAPS_API_KEY` → no-op. Toute erreur → [] (jamais bloquant).
 */
async function searchGoogleFallback(
  q: string,
  cfg: Pick<
    GeoConfig,
    | "geocodeGoogleEnabled"
    | "googleMinQlen"
    | "googleDailyGlobal"
    | "googleDailyPerUser"
  >,
  lat?: number,
  lng?: number
): Promise<GeoHit[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  // Kill-switch coût (geocode_google_enabled) + clé requise.
  if (!key || !cfg.geocodeGoogleEnabled) return [];
  const qn = q.trim().toLowerCase();
  if (qn.length < cfg.googleMinQlen) return [];
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;

    // 1) Cache 30 j (gratuit) — TOUJOURS servi, sans condition d'auth.
    const cached = (await rpc("geo_google_cache_get", { p_q: qn })).data;
    if (Array.isArray(cached))
      return (cached as GeoHit[]).map((r) => ({
        ...r,
        kind: "google" as const,
      }));

    // 2) Chemin PAYANT : plafonds. Par client si connecté (anti-abus), et
    //    plafond GLOBAL toujours (filet dur). PAS de blocage si non connecté —
    //    le cache + le plafond global bornent déjà le coût. (Auparavant un
    //    getUser() null tuait le fallback : corrigé.)
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const okUser =
        (
          await rpc("api_quota_take", {
            p_name: `gp:${user.id}`,
            p_cap: cfg.googleDailyPerUser,
          })
        ).data === true;
      if (!okUser) return [];
    }
    const okGlobal =
      (
        await rpc("api_quota_take", {
          p_name: "gp_global",
          p_cap: cfg.googleDailyGlobal,
        })
      ).data === true;
    if (!okGlobal) return [];

    // 3) Places Text Search (New) — field mask minimal (nom + adresse + coord).
    const body: Record<string, unknown> = {
      textQuery: q,
      regionCode: "DZ",
      languageCode: "fr",
      maxResultCount: 5,
    };
    if (lat !== undefined && lng !== undefined) {
      body.locationBias = {
        circle: { center: { latitude: lat, longitude: lng }, radius: 50000 },
      };
    }
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      places?: {
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude: number; longitude: number };
      }[];
    };
    const hits: GeoHit[] = (json.places ?? [])
      .filter((p) => p.location && p.displayName?.text)
      .map((p) => ({
        display: p.displayName!.text!,
        secondary: p.formattedAddress ?? undefined,
        lat: p.location!.latitude,
        lng: p.location!.longitude,
        kind: "google" as const,
      }));

    // 4) Cache 30 j si on a des résultats.
    if (hits.length)
      await rpc("geo_google_cache_put", { p_q: qn, p_results: hits });
    return hits;
  } catch {
    return [];
  }
}

/**
 * Apprentissage : enregistre le CHOIX d'une adresse (best-effort). Les lieux
 * souvent choisis par les clients remontent ensuite dans le classement du
 * gazetteer (mig 0179, bonus geo_picks proportionnel au match de nom).
 */
export async function recordPlacePick(input: {
  lat: number;
  lng: number;
  label: string;
}): Promise<void> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    // APPRENTISSAGE (mig 0432) : le lieu réellement CHOISI entre dans notre
    // gazetteer. Pas ce que le client tape, pas ce qu'on lui propose — ce
    // qu'il retient. Demain, « Cité des douaniers » sera trouvée sans Google.
    // Écriture en service_role : le navigateur ne doit pas pouvoir remplir la
    // base de faux lieux. Best-effort, jamais bloquant.
    void (async () => {
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        const arpc = admin.rpc.bind(admin) as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<unknown>;
        await arpc("geo_learn_place", {
          p_name: input.label,
          p_lat: input.lat,
          p_lng: input.lng,
          p_wilaya: null,
        });
      } catch {
        /* apprentissage best-effort */
      }
    })();

    await rpc("geo_pick_record", {
      p_lat: input.lat,
      p_lng: input.lng,
      p_label: input.label,
    });
    // Historique PERSONNEL (boost « Tes lieux ») — ignoré si non connecté.
    await rpc("user_place_record", {
      p_lat: input.lat,
      p_lng: input.lng,
      p_label: input.label,
    });
  } catch {
    /* best effort — ne bloque jamais la sélection */
  }
}

export type FavPlace = { label: string; lat: number; lng: number };

/** (Dé)marque une adresse comme favorite pour le client connecté. */
export async function toggleFavoritePlace(input: {
  lat: number;
  lng: number;
  label: string;
  on: boolean;
}): Promise<void> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    await rpc("user_place_fav", {
      p_lat: input.lat,
      p_lng: input.lng,
      p_label: input.label,
      p_on: input.on,
    });
  } catch {
    /* best effort */
  }
}

/** Adresses favorites du client connecté (accès rapide « Tes lieux »). */
export async function listFavoritePlaces(): Promise<FavPlace[]> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    const { data } = await rpc("user_place_mine", {});
    return (
      (data as
        | {
            label: string | null;
            lat: number;
            lng: number;
            favorite: boolean;
          }[]
        | null) ?? []
    )
      .filter((r) => r.favorite && r.label)
      .map((r) => ({ label: r.label as string, lat: r.lat, lng: r.lng }));
  } catch {
    return [];
  }
}

/** Lieux RÉCEMMENT choisis par le client (historique « Lieux précédents »),
 *  hors favoris (qui ont leur propre liste). Les plus récents d'abord. */
export async function listRecentPlaces(): Promise<FavPlace[]> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    const { data } = await rpc("user_place_mine", {});
    return (
      (data as
        | {
            label: string | null;
            lat: number;
            lng: number;
            favorite: boolean;
          }[]
        | null) ?? []
    )
      .filter((r) => !r.favorite && r.label)
      .map((r) => ({ label: r.label as string, lat: r.lat, lng: r.lng }))
      .slice(0, 6);
  } catch {
    return [];
  }
}

export async function geocodeSearch(input: {
  q: string;
  lat?: number;
  lng?: number;
  /**
   * Drive : le client demande un LIEU où aller — un commerce Coligo ne passe
   * DEVANT les lieux que sur correspondance quasi exacte de l'enseigne
   * (score ≥ 0.75). Sans ce mode, les commerces fiables (≥ 0.45) prenaient
   * systématiquement la tête et masquaient l'endroit réellement demandé.
   */
  preferPlaces?: boolean;
}): Promise<GeocodeSearchResult> {
  const q = (input.q ?? "").trim();
  if (q.length < 3) return { ok: true, results: [] };
  const lat = Number.isFinite(input.lat) ? input.lat : undefined;
  const lng = Number.isFinite(input.lng) ? input.lng : undefined;

  // Config géo (nb de suggestions, plafonds/kill-switch Google) — RÈGLE 2 :
  // aucune valeur en dur. Surchargeable par ville (non câblé ici : la recherche
  // d'adresse est nationale ; le scope ville s'appliquera aux devis/prix).
  const cfg = await getGeoConfig();
  const maxN = cfg.addressSuggestionsMax;

  // Boost PERSONNEL « Tes lieux » : les favoris et les lieux déjà choisis par CE
  // client remontent en tête, POUR LUI. Tri stable (ordre d'origine préservé à
  // rang égal). Non connecté / sans historique → liste inchangée.
  // Résultats Google TOUJOURS en tête de la liste de suggestions (ils ne sortent
  // qu'en dernier recours, quand les cartes gratuites n'ont pas l'enseigne
  // cherchée → c'est la réponse la plus pertinente). Partition stable, appliquée
  // APRÈS la personnalisation (qui sinon remonterait les lieux favoris au-dessus).
  const googleFirst = (list: GeoHit[]): GeoHit[] => [
    ...list.filter((r) => r.kind === "google"),
    ...list.filter((r) => r.kind !== "google"),
  ];

  const personalize = async (list: GeoHit[]): Promise<GeoHit[]> => {
    try {
      const sb = await createClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) return list;
      const prpc = sb.rpc.bind(sb) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: unknown }>;
      const mine =
        ((await prpc("user_place_mine", {})).data as
          | { cell: string; favorite: boolean; picks: number }[]
          | null) ?? [];
      if (!mine.length) return list;
      const byCell = new Map(mine.map((x) => [x.cell, x]));
      const rank = (r: GeoHit) => {
        const s = byCell.get(`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`);
        return s ? (s.favorite ? 2 : 1) : 0;
      };
      return list
        .map((r, i) => ({ r, i }))
        .sort((a, b) => rank(b.r) - rank(a.r) || a.i - b.i)
        .map((x) => x.r);
    } catch {
      return list;
    }
  };

  const [local, merchants, remote] = await Promise.all([
    searchLocalGazetteer(q, lat, lng),
    searchMerchants(q, lat, lng),
    searchPhoton(q, lat, lng).catch(() => []),
  ]);

  // Fusion + classement intelligent :
  //   1. commerces enregistrés fiables (le client tape souvent un nom d'enseigne)
  //   2. lieux du gazetteer fiables (graphies locales)
  //   3. rues / POI Photon-Nominatim
  //   4. le reste (commerces puis lieux faibles)
  // Les commerces sont triés par score : proximité + popularité (commandes,
  // note) intégrées dans la RPC.
  const byScore = (a: { score: number }, b: { score: number }) =>
    b.score - a.score;
  const confLocal = local.filter((r) => r.score >= 0.5);
  const weakLocal = local.filter((r) => r.score < 0.5);
  const confMerchAll = merchants.filter((r) => r.score >= 0.45).sort(byScore);
  const weakMerch = merchants.filter((r) => r.score < 0.45).sort(byScore);
  // Requête = NOM DE WILAYA exact (« Béjaïa », « بجاية »…) : le client veut la
  // VILLE — aucun commerce ne passe devant les lieux, quel que soit son score
  // (vécu : « Béjaïa » proposait d'abord « Le Fournil de Béjaïa »). Essentiel
  // pour les trajets Inter-wilayas. Égalité STRICTE après normalisation (une
  // requête « restaurant Béjaïa » reste un cas commerce normal).
  const qNorm = normalizeForMatch(q);
  const isWilayaQuery = WILAYAS.some(
    (w) =>
      normalizeForMatch(w.name) === qNorm ||
      normalizeForMatch(w.name_ar) === qNorm
  );
  // Mode « lieux d'abord » (Drive) : seul un commerce quasi certain (enseigne
  // réellement nommée) garde la tête ; les autres passent APRÈS les lieux.
  const confMerch = isWilayaQuery
    ? []
    : input.preferPlaces
      ? confMerchAll.filter((r) => r.score >= 0.75)
      : confMerchAll;
  const midMerch = isWilayaQuery
    ? confMerchAll
    : input.preferPlaces
      ? confMerchAll.filter((r) => r.score < 0.75)
      : [];
  // ── GOOGLE EN TÊTE (moteur `address-search`) ──────────────────────────
  // Notre gazetteer couvre les localités, pas les cités ni les lotissements :
  // « Cité des douaniers », « Ighil Ouzoug »… restaient introuvables. Google
  // les connaît. Ses résultats passent donc DEVANT, et le reste (commerces
  // Coligo, gazetteer, OSM) continue de remplir la liste derrière.
  // Indisponible ou trop lent → on n'attend pas, le classement d'avant
  // s'applique tel quel.
  const googleHits: GeoHit[] = [];
  try {
    const { searchAddresses } = await import("@/lib/geo/address-search");
    const gh = await searchAddresses(
      input.q,
      input.lat != null && input.lng != null
        ? { lat: input.lat, lng: input.lng }
        : null
    );
    for (const h of gh) {
      if (h.source !== "google") continue; // le reste est déjà couvert plus bas
      googleHits.push({
        display: h.label,
        secondary: h.sub ?? undefined,
        lat: h.lat,
        lng: h.lng,
        kind: "google",
      });
    }
  } catch {
    /* moteur indisponible : on garde le classement historique */
  }

  const results: GeoHit[] = [];
  for (const r of [
    ...googleHits,
    ...confMerch,
    ...confLocal,
    ...remote,
    ...midMerch,
    ...weakMerch,
    ...weakLocal,
  ]) {
    if (geoIsDuplicate(r, results)) continue;
    results.push({
      display: r.display,
      secondary: r.secondary,
      lat: r.lat,
      lng: r.lng,
      kind: r.kind,
    });
    if (results.length >= maxN) break;
  }

  // Dernier recours PAYANT : Google Places uniquement quand les sources
  // gratuites sont clairement insuffisantes (aucun résultat fiable ET < 4 au
  // total). Les verrous coût (cache + quotas) sont dans searchGoogleFallback.
  // Un résultat gratuit "répond"-il VRAIMENT à la requête ? On exige que les
  // mots DISTINCTIFS (hors génériques) soient TOUS présents dans un même
  // résultat. Sinon, ce que cherche le client (souvent une enseigne précise,
  // ex. « Il Capo Béjaïa ») est absent des sources gratuites → on élargit, même
  // s'il y a déjà plein de résultats de la ville.
  const fold = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const qTokens = [
    ...new Set(
      fold(q)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3 && !SEARCH_GENERIC.has(w))
    ),
  ];
  const matchesQuery = () =>
    qTokens.length === 0 ||
    results.some((r) => {
      const h = fold(`${r.display} ${r.secondary ?? ""}`);
      return qTokens.every((t) => h.includes(t));
    });
  const pushUnique = (arr: GeoHit[]) => {
    for (const r of arr) {
      if (geoIsDuplicate(r, results)) continue;
      results.push({
        display: r.display,
        secondary: r.secondary,
        lat: r.lat,
        lng: r.lng,
      });
      if (results.length >= maxN) break;
    }
  };

  if (!matchesQuery()) {
    // 2a) Nominatim (OSM, GRATUIT) d'abord.
    pushUnique(await searchNominatim(q).catch(() => []));

    // 2b) Google Places en dernier recours si toujours aucune correspondance
    //     complète (l'enseigne cherchée est introuvable gratuitement).
    if (!matchesQuery()) {
      const g = await searchGoogleFallback(q, cfg, lat, lng);
      if (g.length) {
        // Google EN TÊTE (c'est lui qui a l'enseigne exacte), puis le reste.
        const merged: GeoHit[] = [];
        for (const r of [...g, ...results]) {
          if (geoIsDuplicate(r, merged)) continue;
          merged.push({
            display: r.display,
            secondary: r.secondary,
            lat: r.lat,
            lng: r.lng,
            kind: r.kind,
          });
          if (merged.length >= maxN) break;
        }
        return { ok: true, results: googleFirst(await personalize(merged)) };
      }
    }
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

  return { ok: true, results: googleFirst(await personalize(results)) };
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
  // Distance/temps AUTORITAIRES : OSRM (route réelle, apprend le détour) ou, à
  // défaut, ligne droite × facteur de détour APPRIS par zone (mig 0235) — jamais
  // un 1,25 fixe qui sous-estime les vraies routes (cf. trajets côtiers).
  const r = await roadRoute(from, to);
  return {
    ok: true,
    distance_km: r.km,
    duration_min: r.min,
    geometry: r.geometry,
  };
}

/** Déconnexion client (utilisable depuis n'importe quelle page client). */
export async function customerLogout(): Promise<void> {
  const supabase = await createClient();
  await clearMyDeviceTokens("customer"); // couper les push perso au logout
  await supabase.auth.signOut();
  await markSignedOut();
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
  const user = await getAuthUser();
  if (!user) return { ok: true };
  const supabase = await createClient();
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
  const customer = await getCurrentCustomer();
  if (!customer) return { favorite: false, error: "auth" };

  const supabase = await createClient();
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
