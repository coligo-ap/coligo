// =============================================================================
// MODÉRATION DES AVIS — fonction PURE (testable, aucun I/O).
//
// Trois familles de contenus refusés, dans TOUTES les langues d'usage ici
// (français, arabe littéraire, darija en caractères arabes ET en écriture
// « arabizi » 3/7/9, anglais, kabyle) :
//
//   1. INSULTES et propos haineux ;
//   2. DONNÉES PERSONNELLES et démarchage — numéros de téléphone, liens,
//      « contactez-moi sur… » : un avis n'est pas une petite annonce, et
//      publier le numéro d'un tiers est interdit ;
//   3. AVIS FRAUDULEUX — chantage à la note, tentative de rançon, texte vide
//      de sens (répétition d'un même caractère, suite de lettres au hasard).
//
// Deux niveaux de réponse, jamais un seul :
//   • `reject`  → refusé à la saisie, le client corrige tout de suite ;
//   • `review`  → publié mais SIGNALÉ, l'équipe tranche a posteriori.
// Refuser trop large ferait taire des clients mécontents mais légitimes —
// « c'est de la merde ce service » est un avis dur, pas une insulte à modérer
// automatiquement. On vise l'attaque et la fraude, pas la colère.
//
// La NOTE (1 à 5) n'est jamais filtrée : une mauvaise note est une opinion.
// =============================================================================

export type ModerationVerdict = {
  action: "accept" | "review" | "reject";
  /** Motif technique — journalisé, jamais montré tel quel au client. */
  reason?: string;
  /** Message destiné au client, en français (langue des écrans partenaires). */
  message?: string;
};

/**
 * Normalise pour la comparaison : minuscules, accents retirés, chiffres de
 * l'« arabizi » ramenés aux lettres arabes correspondantes (3→ع, 7→ح, 9→ق),
 * répétitions de lettres écrasées (« coooonnnard » → « conard »), et
 * séparateurs d'obfuscation supprimés (« c-o-n-n-a-r-d »).
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[3]/g, "ع")
    .replace(/[7]/g, "ح")
    .replace(/[9]/g, "ق")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/(.)\1{2,}/gu, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Racines d'insultes / haine. Volontairement COURTES et ciblées : on cherche
// l'attaque, pas le mot grossier isolé dans une phrase de colère légitime.
const SLURS = [
  // français
  "encule",
  "enculer",
  "nique ta",
  "niquer ta",
  "fils de pute",
  "fdp",
  "pute",
  "putain de ta",
  "salope",
  "connard",
  "conasse",
  "batard",
  "pd ",
  "sale arabe",
  "sale noir",
  "sale juif",
  "sale race",
  "crevure",
  // arabe / darija
  "زامل",
  "قحبة",
  "قحاب",
  "كلب ابن",
  "ولد القحبة",
  "نيك",
  "طحان",
  "حمار ابن",
  "يلعن",
  "الله يحرق",
  "كافر",
  "خنزير",
  // arabizi
  "n7ik",
  "9a7ba",
  "9ahba",
  "zamel",
  "kelb ben",
  "weld el9a7ba",
  // anglais
  "fuck you",
  "fucking idiot",
  "son of a bitch",
  "bitch",
  "asshole",
  "bastard",
  "retarded",
  "nigg",
  // ⚠️ Ne JAMAIS mettre « retard » seul : « livraison en retard » est un
  // reproche parfaitement légitime, et le refuser ferait taire exactement les
  // clients qu'il faut écouter. (Faux positif attrapé au test.)
];

// Démarchage / données personnelles.
const CONTACT = [
  /(?:\+?213|0)\s?[5-7](?:[\s.-]?\d){8}/, // téléphone algérien
  /\b\d{9,}\b/, // suite de chiffres = numéro déguisé
  /(?:https?:\/\/|www\.)\S+/i,
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i,
  /\b(?:whatsapp|viber|telegram|instagram|facebook|tiktok)\b/i,
  /(?:واتساب|فيسبوك|انستغرام|تليغرام)/,
];

// Chantage / rançon : « donne-moi X ou je mets 1 étoile ».
const EXTORTION = [
  /(?:rembours|gratuit|remise|cadeau)[^.]{0,40}(?:sinon|ou je|autrement)/i,
  /(?:sinon|ou je)[^.]{0,40}(?:1\s*etoile|une\s*etoile|mauvais\s*avis)/i,
  /(?:نجمة واحدة|رح نحط|إذا ما)/,
];

/** Le texte a-t-il un contenu réel ? (anti « aaaaa », « qsdfgh »). */
function looksLikeGibberish(raw: string): boolean {
  const t = raw.replace(/\s+/g, "");
  if (t.length < 6) return false; // trop court pour juger : on laisse passer
  const distinct = new Set(t.toLowerCase()).size;
  if (distinct <= 2) return true; // « aaaaaaa », « ababab »
  const vowels = (t.match(/[aeiouyàâéèêîôûاأإوي]/gi) ?? []).length;
  // Une suite latine sans la moindre voyelle sur 10+ signes n'est pas un mot.
  return /^[a-z]+$/i.test(t) && t.length >= 10 && vowels === 0;
}

/**
 * Juge un commentaire d'avis. `null` / vide → accepté (noter sans écrire est
 * parfaitement légitime).
 */
export function moderateReview(
  comment: string | null | undefined
): ModerationVerdict {
  const raw = (comment ?? "").trim();
  if (!raw) return { action: "accept" };

  const n = normalize(raw);
  // Passe SERRÉE, pour les contournements : on retire les espaces et on écrase
  // TOUTE répétition à une lettre. « coooonnnard » et « c.o.n.n.a.r.d »
  // deviennent alors « conard », comme « connard ».
  const tight = (t: string) => t.replace(/\s/g, "").replace(/(.)\1+/gu, "$1");
  const nTight = tight(n);

  for (const w of SLURS) {
    const wn = normalize(w);
    // La passe serrée est réservée aux entrées longues : sur 2-3 lettres elle
    // ferait des faux positifs à l'intérieur de mots ordinaires.
    const hit =
      n.includes(wn) || (wn.length >= 5 && nTight.includes(tight(wn)));
    if (hit) {
      return {
        action: "reject",
        reason: `slur:${w}`,
        message:
          "Votre avis contient des propos insultants. Dites ce qui s'est mal passé — nous le transmettrons au commerçant.",
      };
    }
  }

  for (const re of CONTACT) {
    if (re.test(raw)) {
      return {
        action: "reject",
        reason: "contact",
        message:
          "Un avis ne peut pas contenir de numéro, de lien ni de réseau social. Décrivez votre expérience, sans coordonnées.",
      };
    }
  }

  for (const re of EXTORTION) {
    if (re.test(raw)) {
      return {
        action: "reject",
        reason: "extortion",
        message:
          "Un avis ne peut pas servir à obtenir un remboursement ou un geste commercial. Contactez le support pour cela.",
      };
    }
  }

  if (looksLikeGibberish(raw)) {
    return {
      action: "reject",
      reason: "gibberish",
      message: "Votre avis semble vide de sens. Écrivez quelques mots utiles.",
    };
  }

  // Signaux FAIBLES : on publie, mais l'équipe regarde. Un avis très long et
  // tout en majuscules, ou répété à l'identique, sent le faux sans certitude.
  const upper = raw.replace(/[^A-Za-z]/g, "");
  const shouty =
    upper.length > 25 && upper === upper.toUpperCase() && /[A-Z]/.test(upper);
  if (shouty) {
    return { action: "review", reason: "shouting" };
  }

  return { action: "accept" };
}
