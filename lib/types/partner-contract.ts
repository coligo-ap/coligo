// =============================================================================
// Contrat de partenariat livreur / chauffeur (mig 0344) — pendant du contrat
// commerçant (lib/types/merchant-contract). party/terms figés à l'émission.
// =============================================================================

import type { ContractEquipmentItem } from "@/lib/types/merchant-contract";

export type PartnerKind = "driver" | "chauffeur";

export const PARTNER_KIND_META: Record<
  PartnerKind,
  { label: string; role: string; adminDomain: "livraison" | "drive" }
> = {
  driver: {
    label: "livreur",
    role: "Livreur partenaire",
    adminDomain: "livraison",
  },
  chauffeur: {
    label: "chauffeur",
    role: "Chauffeur partenaire",
    adminDomain: "drive",
  },
};

export type PartnerParty = {
  full_name: string;
  /** N° de la pièce d'identité nationale (CNI / passeport). */
  id_number: string;
  /** N° du permis de conduire. */
  license_number: string;
  /** Statut d'exercice déclaré (indépendant, auto-entrepreneur…). */
  work_status: string;
  /** Immatriculation professionnelle éventuelle (auto-entrepreneur, RC…). */
  registration_number: string;
  address: string;
  wilaya: string;
  phone: string;
  email: string;
  vehicle_type: string;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_plate: string;
};

export type PartnerTerms = {
  /** Frais de service Coligo (%) prélevés sur chaque course/livraison. */
  fee_pct: number;
  /** Plafond de fonds (espèces clients) détenus pour le compte de tiers — livreur. */
  float_cap_da: number;
  /** Plafond de dette au-delà duquel le compte est gelé. */
  debt_cap_da: number;
  /** Cycle de règlement des espèces détenues / commissions dues (jours). */
  settlement_days: number;
  /** Délai de versement des gains dus au partenaire (jours ouvrés). */
  payout_delay_days: number;
  duration_type: "indeterminee" | "determinee";
  duration_months: number | null;
  notice_days: number;
  effective_date: string;
  sign_place: string;
  equipment: {
    provided: boolean;
    return_required: boolean;
    items: ContractEquipmentItem[];
  };
};

export type PartnerContractRow = {
  id: string;
  contract_number: string;
  partner_kind: PartnerKind;
  partner_id: string | null;
  status: "issued" | "signed" | "terminated";
  party: PartnerParty;
  terms: PartnerTerms;
  created_at: string;
  signed_at: string | null;
  signed_file_path: string | null;
  terminated_at: string | null;
  notes: string | null;
};

export const PARTNER_WORK_STATUS = [
  "Travailleur indépendant",
  "Auto-entrepreneur",
  "Commerçant (registre de commerce)",
  "Autre",
] as const;

export const PARTNER_EQUIPMENT_PRESETS: Record<PartnerKind, readonly string[]> =
  {
    driver: [
      "Sac de livraison isotherme",
      "Tenue / gilet Coligo",
      "Support téléphone",
      "Tablette (commandes)",
    ],
    chauffeur: [
      "Support téléphone",
      "Autocollant / signalétique Coligo",
      "Tablette (courses)",
    ],
  };
