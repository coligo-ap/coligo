/**
 * Moteur de zones — types & libellés partagés (client + serveur).
 *
 * La résolution réelle vit en base (RPC `evaluate_service_zone`, mig 0169) :
 * GÉOMÉTRIQUE d'abord (country/radius/polygon, infalsifiable) + wilaya/commune.
 * Ici on ne porte que les types et la traduction d'un verdict en message FR.
 */

export type ServiceKind = "express" | "tour" | "drive";
export type ZoneRole = "origin" | "destination" | "any";
export type ZoneScope = "country" | "wilaya" | "commune" | "radius" | "polygon";
export type ZoneMode = "allow" | "block";

/** Verdict renvoyé par `evaluate_service_zone`. */
export type ZoneEval = {
  allowed: boolean;
  /** ok | service_inactive | blocked | no_coverage */
  reason: string;
  label: string | null;
  coming_soon: boolean;
};

export const SERVICE_LABELS: Record<ServiceKind, string> = {
  express: "Livraison Express",
  tour: "Livraison en tournée",
  drive: "Coligo Drive",
};

/** Verdict « tout va bien » par défaut (fail-open sur erreur infra). */
export const ZONE_OK: ZoneEval = {
  allowed: true,
  reason: "ok",
  label: null,
  coming_soon: false,
};

/**
 * Traduit un verdict bloquant en message client clair (FR). Renvoie "" si
 * autorisé. Le rôle affine le message (départ vs destination pour Drive).
 */
export function zoneMessageFr(
  e: ZoneEval,
  role: ZoneRole,
  service: ServiceKind
): string {
  if (e.allowed) return "";
  const isDrive = service === "drive";
  switch (e.reason) {
    case "service_inactive":
      return isDrive
        ? "Coligo Drive est temporairement indisponible."
        : "La livraison est temporairement indisponible.";
    case "blocked":
      if (e.coming_soon) return "Zone bientôt disponible — restez connecté !";
      if (role === "destination")
        return "Cette destination n'est pas encore couverte.";
      if (role === "origin")
        return isDrive
          ? "Aucun déplacement disponible depuis ce point de départ."
          : "Service non disponible dans votre zone.";
      return "Service non disponible dans votre zone.";
    case "no_coverage":
      return role === "destination"
        ? "Cette destination n'est pas encore couverte."
        : isDrive
          ? "Coligo Drive n'est pas encore disponible dans cette zone."
          : "Service non disponible dans votre zone.";
    default:
      return "Service non disponible dans votre zone.";
  }
}
