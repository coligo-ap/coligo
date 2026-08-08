/**
 * Badges de mérite chauffeur — calcul PUR (utilisable client ET serveur).
 *
 * Objectif produit : récompenser et pousser (marketing / psychologie) les
 * chauffeurs à travailler en QUALITÉ. Le niveau dépend de deux signaux visibles
 * partout (profil chauffeur + côté client sur les offres) :
 *   - le NOMBRE DE COURSES (expérience / volume) ;
 *   - la NOTE moyenne (qualité de service).
 * On garde ces deux critères pour que le badge soit IDENTIQUE des deux côtés
 * (le client ne dispose pas toujours de l'ancienneté exacte). 5 niveaux, chacun
 * sa couleur, son emoji et son accroche.
 */
import { BADGE_TIERS } from "@/lib/design/tokens";

export type DriverBadgeTier = "recrue" | "bronze" | "argent" | "or" | "diamant";

export type DriverBadge = {
  tier: DriverBadgeTier;
  /** Niveau (court) : « Or ». */
  label: string;
  /** Accroche valorisante : « Chauffeur d'élite ». */
  title: string;
  /** Dégradé de fond de la pastille. */
  gradient: string;
  /** Couleur pleine (contour d'avatar / anneau). */
  solid: string;
  /** Couleur du texte sur le dégradé. */
  text: string;
  /** Emoji du niveau. */
  emoji: string;
};

/** Dégradé 135° d'un palier — même écriture qu'avant, valeurs des tokens. */
const grad = (t: (typeof BADGE_TIERS)[DriverBadgeTier]) =>
  `linear-gradient(135deg,${t.from},${t.to})`;

const RECRUE: DriverBadge = {
  tier: "recrue",
  label: "Recrue",
  title: "Nouveau chauffeur",
  gradient: grad(BADGE_TIERS.recrue),
  solid: BADGE_TIERS.recrue.solid,
  text: BADGE_TIERS.recrue.text,
  emoji: "🌱",
};
const BRONZE: DriverBadge = {
  tier: "bronze",
  label: "Bronze",
  title: "Chauffeur confirmé",
  gradient: grad(BADGE_TIERS.bronze),
  solid: BADGE_TIERS.bronze.solid,
  text: BADGE_TIERS.bronze.text,
  emoji: "🥉",
};
const ARGENT: DriverBadge = {
  tier: "argent",
  label: "Argent",
  title: "Chauffeur de confiance",
  gradient: grad(BADGE_TIERS.argent),
  solid: BADGE_TIERS.argent.solid,
  text: BADGE_TIERS.argent.text,
  emoji: "🥈",
};
const OR: DriverBadge = {
  tier: "or",
  label: "Or",
  title: "Chauffeur d'exception",
  gradient: grad(BADGE_TIERS.or),
  solid: BADGE_TIERS.or.solid,
  text: BADGE_TIERS.or.text,
  emoji: "🥇",
};
const DIAMANT: DriverBadge = {
  tier: "diamant",
  label: "Diamant",
  title: "Chauffeur d'élite",
  gradient: grad(BADGE_TIERS.diamant),
  solid: BADGE_TIERS.diamant.solid,
  text: BADGE_TIERS.diamant.text,
  emoji: "💎",
};

export function getDriverBadge(input: {
  ridesCount: number;
  rating: number | null;
}): DriverBadge {
  const rides = Math.max(0, input.ridesCount ?? 0);
  const r = input.rating ?? 0;
  if (rides >= 700 && r >= 4.8) return DIAMANT;
  if (rides >= 300 && r >= 4.5) return OR;
  if (rides >= 100 && r >= 4.0) return ARGENT;
  if (rides >= 25) return BRONZE;
  return RECRUE;
}
