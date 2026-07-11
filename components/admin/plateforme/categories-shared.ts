export type AdminCategory = {
  code: string;
  label: string;
  labelAr: string;
  emoji: string;
  imageUrl: string | null;
  status: "active" | "hidden" | "coming_soon";
  /** type = commerce classique ; filter = FILTRE ÉDITORIAL (mapping auto). */
  kind: "type" | "filter";
  keywords: string[];
  /** Affichée dans le strip marketplace (mig 0336). */
  showMarketplace: boolean;
  /** Proposée à l'inscription commerçant (mig 0336). */
  showSignup: boolean;
  /** Commerçants dont c'est la catégorie PRINCIPALE. */
  merchants: number;
  /** Liaisons SECONDAIRES (commerçants dont la principale diffère). */
  links: number;
  /** TOUTES les liaisons — même définition que la garde serveur de
   *  suppression : le bouton se désactive exactement quand le serveur
   *  refuserait. */
  linksTotal: number;
};

export const STATUS_LABEL: Record<AdminCategory["status"], string> = {
  active: "Actif",
  hidden: "Masqué",
  coming_soon: "Bientôt disponible",
};
