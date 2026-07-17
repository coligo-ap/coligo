/**
 * Identité légale de l'éditeur de la plateforme — source unique pour les
 * pages CGU / confidentialité / mentions légales / contact.
 *
 * Statut : auto-entrepreneur (loi n° 22-23 du 18 décembre 2022 portant
 * statut de l'auto-entrepreneur).
 */
export const LEGAL = {
  /** Nom commercial de la plateforme. */
  platform: "Coligo",
  /** Exploitant (personne physique). */
  ownerFullName: "GACI Noufel",
  status: "Auto-entrepreneur",
  statusLaw:
    "loi n° 22-23 du 18 décembre 2022 portant statut de l'auto-entrepreneur",
  registrationLabel: "Registre national de l'auto-entrepreneur",
  registrationNumber: "10981022005702687",
  /** Adresse professionnelle (siège de la micro-entreprise). */
  address: "Akbou, Béjaïa 06001, Algérie",
  country: "Algérie",
  site: "https://coligo.app",
  /** Date affichée sur les documents légaux — mettre à jour à chaque révision. */
  lastUpdate: "17 juillet 2026",
  hosting: {
    web: "Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (réseau de serveurs mondial ; le traitement applicatif de Coligo s'exécute sur des serveurs situés en Irlande, Union européenne)",
    data: "Supabase Inc. (base de données et stockage), serveurs situés en Irlande, Union européenne",
  },
} as const;
