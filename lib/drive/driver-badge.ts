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

const RECRUE: DriverBadge = {
  tier: "recrue",
  label: "Recrue",
  title: "Nouveau chauffeur",
  gradient: "linear-gradient(135deg,#94A3B8,#64748B)",
  solid: "#64748B",
  text: "#FFFFFF",
  emoji: "🌱",
};
const BRONZE: DriverBadge = {
  tier: "bronze",
  label: "Bronze",
  title: "Chauffeur confirmé",
  gradient: "linear-gradient(135deg,#D8A36B,#A66A2E)",
  solid: "#B4732E",
  text: "#FFFFFF",
  emoji: "🥉",
};
const ARGENT: DriverBadge = {
  tier: "argent",
  label: "Argent",
  title: "Chauffeur de confiance",
  gradient: "linear-gradient(135deg,#E2E8F0,#94A3B8)",
  solid: "#8A93A3",
  text: "#1F2937",
  emoji: "🥈",
};
const OR: DriverBadge = {
  tier: "or",
  label: "Or",
  title: "Chauffeur d'exception",
  gradient: "linear-gradient(135deg,#F7D661,#E0A815)",
  solid: "#E0A815",
  text: "#3A2C00",
  emoji: "🥇",
};
const DIAMANT: DriverBadge = {
  tier: "diamant",
  label: "Diamant",
  title: "Chauffeur d'élite",
  gradient: "linear-gradient(135deg,#67E8F9,#7C3AED)",
  solid: "#7C3AED",
  text: "#FFFFFF",
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
