/**
 * Dossier de vérification d'identité (KYC) du livreur — SOURCE UNIQUE des
 * exigences, partagée par le formulaire (client) et par la validation à l'envoi
 * (serveur). Un dossier incomplet ne peut jamais être transmis : le formulaire
 * empêche l'envoi, et `kycReport()` est ré-évalué côté serveur avant d'écrire
 * `submitted_at`.
 */

export const DRIVER_DOC_TYPES = [
  "cni",
  "selfie",
  "permis",
  "carte_grise",
  "assurance",
  "passeport",
  "autre",
] as const;
export type DriverDocType = (typeof DRIVER_DOC_TYPES)[number];

export const DOC_LABELS: Record<DriverDocType, string> = {
  cni: "Pièce d'identité",
  selfie: "Photo de vous (selfie)",
  permis: "Permis de conduire",
  carte_grise: "Carte grise",
  assurance: "Attestation d'assurance",
  passeport: "Passeport",
  autre: "Autre document",
};

/** Types de véhicule. `motorized` conditionne les pièces exigées. */
export const VEHICLE_TYPES = [
  { value: "velo", label: "Vélo", motorized: false },
  { value: "trottinette", label: "Trottinette", motorized: false },
  { value: "moto", label: "Moto", motorized: true },
  { value: "scooter", label: "Scooter", motorized: true },
  { value: "voiture", label: "Voiture", motorized: true },
  { value: "camionnette", label: "Camionnette", motorized: true },
] as const;

export function isMotorized(vehicleType: string | null | undefined): boolean {
  return VEHICLE_TYPES.some((v) => v.value === vehicleType && v.motorized);
}

export type KycProfile = {
  full_name: string | null;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  wilaya: string | null;
  address: string | null;
  id_card_number: string | null;
  national_id_number: string | null;
  vehicle_type: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
  vehicle_color: string | null;
  vehicle_year: number | null;
};

/** Types de pièces déjà déposées par le livreur. */
export type KycDocs = Partial<Record<DriverDocType, boolean>>;

export type KycItem = {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
};

export type KycSection = {
  id: "personal" | "vehicle";
  title: string;
  items: KycItem[];
  /** Avancement des seuls éléments OBLIGATOIRES (0–100). */
  percent: number;
  complete: boolean;
  /** Libellés des éléments obligatoires encore manquants. */
  missing: string[];
};

export type KycReport = {
  sections: KycSection[];
  percent: number;
  complete: boolean;
  missing: string[];
};

const filled = (v: unknown): boolean =>
  typeof v === "number"
    ? Number.isFinite(v)
    : typeof v === "string"
      ? v.trim().length > 0
      : false;

/** Âge minimum légal pour livrer. */
export const MIN_AGE_YEARS = 18;

export function isAdult(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - MIN_AGE_YEARS);
  return dob <= limit;
}

function section(
  id: KycSection["id"],
  title: string,
  items: KycItem[]
): KycSection {
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => i.done);
  return {
    id,
    title,
    items,
    percent:
      required.length === 0
        ? 100
        : Math.round((done.length / required.length) * 100),
    complete: done.length === required.length,
    missing: required.filter((i) => !i.done).map((i) => i.label),
  };
}

/**
 * Évalue le dossier : avancement par section, éléments manquants, et si
 * l'envoi est autorisé. Appelée à l'identique côté client (affichage) et côté
 * serveur (autorisation d'envoi) — jamais deux règles différentes.
 */
export function kycReport(profile: KycProfile, docs: KycDocs): KycReport {
  const motorized = isMotorized(profile.vehicle_type);

  const personal = section("personal", "Informations personnelles", [
    {
      key: "full_name",
      label: "Nom complet",
      required: true,
      done: filled(profile.full_name),
    },
    {
      key: "date_of_birth",
      label: `Date de naissance (${MIN_AGE_YEARS} ans minimum)`,
      required: true,
      done: isAdult(profile.date_of_birth),
    },
    {
      key: "phone",
      label: "Numéro de téléphone",
      required: true,
      done: filled(profile.phone),
    },
    {
      key: "wilaya",
      label: "Wilaya",
      required: true,
      done: filled(profile.wilaya),
    },
    {
      key: "address",
      label: "Adresse",
      required: true,
      done: filled(profile.address),
    },
    {
      key: "id_card_number",
      label: "Numéro de pièce d'identité",
      required: true,
      done: filled(profile.id_card_number),
    },
    { key: "doc_cni", label: DOC_LABELS.cni, required: true, done: !!docs.cni },
    {
      key: "doc_selfie",
      label: DOC_LABELS.selfie,
      required: true,
      done: !!docs.selfie,
    },
    {
      key: "email",
      label: "Adresse e-mail",
      required: false,
      done: filled(profile.email),
    },
    {
      key: "national_id_number",
      label: "Numéro national (NIN)",
      required: false,
      done: filled(profile.national_id_number),
    },
  ]);

  const vehicle = section("vehicle", "Véhicule", [
    {
      key: "vehicle_type",
      label: "Type de véhicule",
      required: true,
      done: filled(profile.vehicle_type),
    },
    {
      key: "vehicle_brand",
      label: "Marque",
      required: motorized,
      done: filled(profile.vehicle_brand),
    },
    {
      key: "vehicle_model",
      label: "Modèle",
      required: motorized,
      done: filled(profile.vehicle_model),
    },
    {
      key: "vehicle_plate",
      label: "Immatriculation",
      required: motorized,
      done: filled(profile.vehicle_plate),
    },
    {
      key: "doc_permis",
      label: DOC_LABELS.permis,
      required: motorized,
      done: !!docs.permis,
    },
    {
      key: "doc_carte_grise",
      label: DOC_LABELS.carte_grise,
      required: motorized,
      done: !!docs.carte_grise,
    },
    {
      key: "doc_assurance",
      label: DOC_LABELS.assurance,
      required: motorized,
      done: !!docs.assurance,
    },
    {
      key: "vehicle_color",
      label: "Couleur",
      required: false,
      done: filled(profile.vehicle_color),
    },
    {
      key: "vehicle_year",
      label: "Année de mise en circulation",
      required: false,
      done: filled(profile.vehicle_year),
    },
  ]);

  const sections = [personal, vehicle];
  const allRequired = sections.flatMap((s) =>
    s.items.filter((i) => i.required)
  );
  const doneRequired = allRequired.filter((i) => i.done);

  return {
    sections,
    percent:
      allRequired.length === 0
        ? 100
        : Math.round((doneRequired.length / allRequired.length) * 100),
    complete: doneRequired.length === allRequired.length,
    missing: sections.flatMap((s) => s.missing),
  };
}

/** Pièces attendues dans le dossier, selon le type de véhicule. */
export function requiredDocTypes(
  vehicleType: string | null | undefined
): DriverDocType[] {
  const base: DriverDocType[] = ["cni", "selfie"];
  return isMotorized(vehicleType)
    ? [...base, "permis", "carte_grise", "assurance"]
    : base;
}
