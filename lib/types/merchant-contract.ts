// =============================================================================
// Contrat de partenariat commerçant (mig 0343) — types partagés entre le
// formulaire super-admin, les server actions et le générateur PDF.
// Les données des parties et les conditions sont FIGÉES dans le contrat
// (jsonb) : le document reste opposable même si la fiche commerçant change.
// =============================================================================

export type ContractEquipmentItem = {
  /** Désignation (ex. « Tablette Sunmi V2 », « Sac de livraison isotherme »). */
  label: string;
  qty: number;
  /** Valeur unitaire en DA (sert de base de facturation en cas de perte). */
  unit_cost_da: number;
  /** État à la remise : neuf / bon état / usagé. */
  condition: string;
  /** N° de série / IMEI / identifiant unique du matériel. */
  serial: string;
  notes: string;
};

export type ContractParty = {
  /** Raison sociale ou enseigne du commerçant. */
  merchant_name: string;
  /** Forme juridique (personne physique RC, auto-entrepreneur, EURL, SARL…). */
  legal_form: string;
  /** N° registre de commerce (ou immatriculation équivalente). */
  rc_number: string;
  /** Numéro d'identification fiscale. */
  nif: string;
  address: string;
  commune: string;
  wilaya: string;
  phone: string;
  email: string;
  /** Représentant légal signataire (nom complet, qualité). */
  representative: string;
};

export type ContractTerms = {
  commission_cash_pct: number;
  commission_online_pct: number;
  /** Délai (jours) de reversement des commissions dues sur ventes en espèces. */
  cash_settlement_days: number;
  /** Délai (jours ouvrés) de versement des sommes dues au commerçant. */
  payout_delay_days: number;
  /** Plafond d'endettement (DA) au-delà duquel le compte est suspendu. */
  debt_cap_da: number;
  duration_type: "indeterminee" | "determinee";
  /** Durée en mois si déterminée (renouvelable tacitement). */
  duration_months: number | null;
  /** Préavis de résiliation (jours). */
  notice_days: number;
  /** Date d'effet (YYYY-MM-DD). */
  effective_date: string;
  /** Lieu de signature. */
  sign_place: string;
  equipment: {
    provided: boolean;
    /** true = mise à disposition avec restitution ; false (défaut) = cédé. */
    return_required: boolean;
    items: ContractEquipmentItem[];
  };
};

export type MerchantContractStatus = "issued" | "signed" | "terminated";

export type MerchantContractRow = {
  id: string;
  contract_number: string;
  merchant_id: string | null;
  status: MerchantContractStatus;
  party: ContractParty;
  terms: ContractTerms;
  created_at: string;
  signed_at: string | null;
  signed_file_path: string | null;
  terminated_at: string | null;
  notes: string | null;
};

export const CONTRACT_STATUS_META: Record<
  MerchantContractStatus,
  { label: string; tone: "info" | "success" | "danger" }
> = {
  issued: { label: "Émis — en attente de signature", tone: "info" },
  signed: { label: "Signé", tone: "success" },
  terminated: { label: "Résilié", tone: "danger" },
};

export const LEGAL_FORMS = [
  "Personne physique (registre de commerce)",
  "Auto-entrepreneur",
  "Artisan (carte d'artisan)",
  "EURL",
  "SARL",
  "SNC",
  "SPA",
  "Autre",
] as const;

export const EQUIPMENT_CONDITIONS = ["Neuf", "Bon état", "Usagé"] as const;

/** Suggestions de matériel courant (l'admin reste libre du libellé). */
export const EQUIPMENT_PRESETS = [
  "Tablette (commandes)",
  "Sac de livraison isotherme",
  "Imprimante à tickets",
  "Support / chargeur",
] as const;
