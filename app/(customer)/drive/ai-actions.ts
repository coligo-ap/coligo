"use server";

/**
 * Assistant Drive en langage naturel (darija / arabe / français) — SANS IA payante.
 *
 * Pour réserver une course, le seul vrai travail est de TROUVER LE LIEU. Et ça,
 * le gazetteer DZ ([[geo_places]] + Photon/Nominatim) le fait déjà, gratuitement
 * et en tolérant les graphies darija. Donc ici : un parseur 100 % déterministe
 * (mots-clés + nettoyage) extrait destination/gamme/départ, puis on délègue la
 * résolution du lieu au gazetteer. Coût plateforme = 0, latence ≈ instantanée,
 * aucune clé API. (L'IA payante reste pertinente pour le futur « panier
 * courses » multi-produits, pas pour le Drive.)
 *
 * Le résultat est un BROUILLON : le client confirme via l'écran prix habituel
 * (devis, paiement, demande). request_ride reste seul juge. Aucune dépense
 * déclenchée.
 */

import { createClient } from "@/lib/supabase/server";
import { geocodeSearch } from "@/app/(customer)/actions";
import { haversineKm } from "@/lib/delivery/distance";

export type DriveGamme = "classic" | "confort" | "moto";

export type DriveIntentDraft = {
  /** Départ : position GPS actuelle (text null) sauf si le client en nomme un autre. */
  pickup: { lat: number; lng: number; text: string | null };
  destination: { lat: number; lng: number; text: string; kind?: "merchant" };
  /** Autres lieux candidats pour la destination (si ambiguë), à proposer au client. */
  alternatives: {
    lat: number;
    lng: number;
    display: string;
    kind?: "merchant";
  }[];
  distance_km: number;
  gamme: DriveGamme;
  female_only: boolean;
  urgent: boolean;
  suggested_price_da: number;
};

export type DriveIntentResult =
  | { ok: true; draft: DriveIntentDraft }
  | {
      ok: false;
      reason: "auth" | "input" | "parse" | "not_found";
      message: string;
    };

/* ───────────────────────── Parseur déterministe ───────────────────────── */

// Normalise : minuscules, retire les accents latins (l'arabe est préservé),
// espaces compactés. "À Béjaïa" → "a bejaia".
function normalize(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      // Apostrophe = élision (« d'alger », « l'arbaa ») → séparateur de mots.
      .replace(/['’]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Mots-clés gamme / femme / urgence (darija + ar + fr). Détectés puis retirés
// pour ne pas polluer la recherche du lieu.
const GAMME_RX: { rx: RegExp; g: DriveGamme }[] = [
  { rx: /\b(moto|moteur|clando|kamikaz|kawa)\b/u, g: "moto" },
  {
    rx: /\b(confort|comfort|clim|climatis\w*|premium|vip|berline)\b/u,
    g: "confort",
  },
];
const FEMALE_RX =
  /\b(femme|female|conductrice|chauffeuse|mra|imraa)\b|امرأة|سائقة/u;
const URGENT_RX =
  /\b(vite|rapide|urgent|maintenant|daba|tawa|fissa|daghya|degya)\b|بسرعة|دابا/u;

// Bruit fréquent à retirer (verbes/politesse darija+fr). Volontairement court :
// le gazetteer classe déjà les mots non pertinents en bas, pas besoin d'être
// exhaustif. On ne touche JAMAIS aux articles "el/le/la" (souvent dans les noms
// de lieux : "El Mohammadia", "La Casbah").
const FILLER = new Set([
  "je",
  "veux",
  "aller",
  "voudrais",
  "jaimerais",
  "vais",
  "jveux",
  "jaime",
  "amene",
  "emmene",
  "conduis",
  "moi",
  "emmenne",
  "emmenez",
  "stp",
  "svp",
  "please",
  "yallah",
  "yalla",
  "khouya",
  "khoya",
  "sahbi",
  "khoyy",
  "akhi",
  "rani",
  "raki",
  "rayah",
  "rayeh",
  "nroh",
  "nrouh",
  "nemchi",
  "nemchiw",
  "bghit",
  "habit",
  "bghite",
  "rah",
  "course",
  "taxi",
  "besoin",
  "wesselni",
  "wassalni",
  "wesslni",
  "dini",
  "warredni",
  "jibni",
  // petites prépositions / marqueurs déjà traités par splitTrip
  "a",
  "l",
  "ila",
  "pour",
  "direction",
  "jusqua",
  "jusqu",
  "ndir",
  // particules de liaison darija (avec/dans/sur/de) — jamais des noms de lieux
  "b",
  "f",
  "fi",
  "3la",
  "ela",
  "ntaa",
  "nta3",
  "taa",
  "dial",
  "d",
  // marqueurs de trajet (résidus éventuels après la découpe départ/arrivée)
  "de",
  "du",
  "des",
  "au",
  "aux",
  "en",
  "vers",
  "depuis",
  "men",
  "mn",
]);

// Marqueurs de découpe « départ → arrivée ». Forts = découpe toujours ; faibles
// (« de/d' », « à ») = seulement en présence d'un marqueur d'arrivée, pour ne
// pas casser un nom de lieu (« rue de la liberté »).
const STRONG_FROM = new Set(["depuis", "men", "mn", "من"]);
const STRONG_TO = new Set(["vers", "direction", "ila", "الى", "إلى"]);
const WEAK_FROM = new Set(["de", "du", "des", "d"]);
const WEAK_TO = new Set(["a", "au", "aux"]);

// Sépare départ et arrivée par tokens. Gère les deux ordres :
//   « (de) X vers Y »  → départ X, arrivée Y
//   « vers Y depuis X » → arrivée Y, départ X
//   « vers Y » / « à Y » → arrivée Y, départ = position actuelle
//   « depuis X »        → départ X, arrivée = ce qui précède
function splitTrip(text: string): { dest: string; pickup: string } {
  const toks = text.split(/\s+/).filter(Boolean);
  const join = (a: string[]) => a.join(" ").trim();

  const strongFrom = toks.findIndex((w) => STRONG_FROM.has(w));
  let toPos = toks.findIndex((w) => STRONG_TO.has(w));
  if (toPos < 0) toPos = toks.findIndex((w) => WEAK_TO.has(w));

  let fromPos = strongFrom;
  if (fromPos < 0 && toPos > 0) {
    for (let i = 0; i < toPos; i++) {
      if (WEAK_FROM.has(toks[i])) {
        fromPos = i;
        break;
      }
    }
  }

  if (fromPos >= 0 && toPos >= 0) {
    return fromPos < toPos
      ? {
          pickup: join(toks.slice(fromPos + 1, toPos)),
          dest: join(toks.slice(toPos + 1)),
        }
      : {
          dest: join(toks.slice(toPos + 1, fromPos)),
          pickup: join(toks.slice(fromPos + 1)),
        };
  }
  if (toPos >= 0) return { dest: join(toks.slice(toPos + 1)), pickup: "" };
  if (strongFrom >= 0)
    return {
      pickup: join(toks.slice(strongFrom + 1)),
      dest: join(toks.slice(0, strongFrom)),
    };
  return { dest: join(toks), pickup: "" };
}

// Retire les mots de bruit, garde le reste pour le gazetteer.
function clean(s: string): string {
  return s
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(" ")
    .trim();
}

/* ──────────────────────────── Action ──────────────────────────── */

export async function parseDriveIntent(input: {
  text: string;
  pickup: { lat: number; lng: number } | null;
}): Promise<DriveIntentResult> {
  // Réservé aux clients connectés (évite de marteler le gazetteer/Nominatim
  // gratuit avec du trafic anonyme).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      ok: false,
      reason: "auth",
      message: "Connecte-toi pour utiliser l'assistant.",
    };

  const raw = (input.text ?? "").trim();
  if (raw.length < 3 || raw.length > 300)
    return {
      ok: false,
      reason: "input",
      message: "Dis en quelques mots où tu veux aller.",
    };

  let norm = normalize(raw);

  // Détection + retrait des modificateurs.
  const female_only = FEMALE_RX.test(norm);
  const urgent = URGENT_RX.test(norm);
  let gamme: DriveGamme = "classic";
  for (const { rx, g } of GAMME_RX) {
    if (rx.test(norm)) {
      gamme = g;
      norm = norm.replace(rx, " ");
    }
  }
  norm = norm
    .replace(FEMALE_RX, " ")
    .replace(URGENT_RX, " ")
    // Marqueurs multi-mots → mono-mot (la découpe travaille par tokens).
    .replace(/\ba partir de\b/g, " depuis ")
    .replace(/\bjusqu a\b/g, " vers ")
    .replace(/\s+/g, " ")
    .trim();

  // Découpe départ/arrivée + nettoyage du bruit.
  const split = splitTrip(norm);
  const destQuery = clean(split.dest);
  const pickupQuery = clean(split.pickup);

  if (destQuery.length < 2)
    return {
      ok: false,
      reason: "parse",
      message:
        "Dis-moi vers où tu veux aller (ex : « Carrefour El Mohammadia »).",
    };

  const bias = input.pickup ?? undefined;

  // Résolution du lieu : gazetteer DZ darija + repli Photon/Nominatim (gratuit).
  const destRes = await geocodeSearch({
    q: destQuery,
    lat: bias?.lat,
    lng: bias?.lng,
  });
  const destHit = destRes.ok ? destRes.results[0] : undefined;
  if (!destHit)
    return {
      ok: false,
      reason: "not_found",
      message: `Je n'ai pas trouvé « ${destQuery} ». Précise le quartier ou la ville.`,
    };

  // Départ : position GPS actuelle, sauf si le client nomme un autre point.
  let pickup: DriveIntentDraft["pickup"] | null = input.pickup
    ? { lat: input.pickup.lat, lng: input.pickup.lng, text: null }
    : null;
  if (pickupQuery.length >= 2) {
    const pRes = await geocodeSearch({
      q: pickupQuery,
      lat: bias?.lat,
      lng: bias?.lng,
    });
    const pHit = pRes.ok ? pRes.results[0] : undefined;
    if (pHit) pickup = { lat: pHit.lat, lng: pHit.lng, text: pHit.display };
  }
  if (!pickup)
    return {
      ok: false,
      reason: "not_found",
      message: "Active ta position ou indique d'où tu pars.",
    };

  // Distance (vol d'oiseau ×1,25 ≈ route, cohérent avec l'app) + prix recommandé.
  const distance_km = Number(
    (
      haversineKm(pickup, { lat: destHit.lat, lng: destHit.lng }) * 1.25
    ).toFixed(2)
  );
  let suggested = 0;
  try {
    // ⚠️ .bind(supabase) + cast : contourne le typage RPC et le piège this.rest
    // (cf. pattern rpcClient des autres actions Drive).
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data } = await rpc("drive_recommended_price", {
      p_distance_km: distance_km,
      p_gamme: gamme,
    });
    suggested = Number(data) || 0;
  } catch {
    suggested = 0;
  }

  return {
    ok: true,
    draft: {
      pickup,
      destination: {
        lat: destHit.lat,
        lng: destHit.lng,
        text: destHit.display,
        kind: destHit.kind,
      },
      alternatives: (destRes.ok ? destRes.results.slice(1, 4) : []).map(
        (r) => ({
          lat: r.lat,
          lng: r.lng,
          display: r.display,
          kind: r.kind,
        })
      ),
      distance_km,
      gamme,
      female_only,
      urgent,
      suggested_price_da: suggested,
    },
  };
}
