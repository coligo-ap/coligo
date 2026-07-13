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

/**
 * Natures acceptées pour LA pièce d'identité. Le livreur en choisit une et
 * dépose la photo correspondante ; le choix n'a pas de colonne dédiée, il se
 * relit de la pièce effectivement déposée (`idDocKindOf`). Un livreur qui
 * reprend son dossier plus tard retrouve donc son choix sans qu'on l'ait stocké.
 */
export const ID_DOC_KINDS = [
  { value: "cni", label: "Carte d'identité" },
  { value: "passeport", label: "Passeport" },
  { value: "permis", label: "Permis de conduire" },
] as const satisfies readonly { value: DriverDocType; label: string }[];

export type IdDocKind = (typeof ID_DOC_KINDS)[number]["value"];

export const DEFAULT_ID_DOC_KIND: IdDocKind = "cni";

/** Retrouve la nature de pièce choisie, d'après ce qui a été déposé. */
export function idDocKindOf(docs: KycDocs): IdDocKind {
  return ID_DOC_KINDS.find((k) => docs[k.value])?.value ?? DEFAULT_ID_DOC_KIND;
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
/** Méthode de vérification d'identité choisie à l'inscription. */
export type KycMethod = "manual" | "instant";

export function kycReport(
  profile: KycProfile,
  docs: KycDocs,
  /**
   * Nature de pièce d'identité choisie. Le formulaire passe la sélection en
   * cours — sinon l'écran annoncerait « identité complète » alors que
   * l'emplacement affiché est vide, parce qu'une AUTRE pièce acceptée (le
   * permis, déposé pour le véhicule) suffirait. Le serveur, lui, n'a pas cette
   * sélection : il relit la pièce réellement déposée.
   */
  idKind: IdDocKind = idDocKindOf(docs),
  /**
   * Vérification d'identité AUTOMATIQUE (IDV). Quand le livreur a choisi la
   * voie « instantanée », sa pièce d'identité et son selfie ne se téléversent
   * PAS : ils sont capturés et contrôlés par le parcours IDV. L'exigence
   * devient donc « identité vérifiée », et elle n'est satisfaite que lorsque
   * le dossier IDV est approuvé — jamais sur simple déclaration.
   */
  idv: { method: KycMethod | null; verified: boolean } = {
    method: null,
    verified: false,
  }
): KycReport {
  const motorized = isMotorized(profile.vehicle_type);
  const instant = idv.method === "instant";

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
    // Identité : soit vérifiée AUTOMATIQUEMENT (parcours IDV), soit prouvée
    // par les pièces téléversées (examen par l'équipe Coligo).
    ...(instant
      ? [
          {
            key: "idv_verified",
            label: "Identité vérifiée (document + selfie)",
            required: true,
            done: idv.verified,
          },
        ]
      : [
          {
            key: "doc_id",
            label: DOC_LABELS.cni,
            required: true,
            done: !!docs[idKind],
          },
          {
            key: "doc_selfie",
            label: DOC_LABELS.selfie,
            required: true,
            done: !!docs.selfie,
          },
        ]),
    {
      key: "email",
      label: "Adresse e-mail",
      required: false,
      done: filled(profile.email),
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
      key: "vehicle_color",
      label: "Couleur",
      required: motorized,
      done: filled(profile.vehicle_color),
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

/**
 * Pièces attendues, selon le type de véhicule et la nature de pièce d'identité
 * choisie. Un livreur motorisé qui présente son permis comme pièce d'identité ne
 * le dépose qu'une fois : `permis` figure alors dans les deux exigences.
 */
export function requiredDocTypes(
  vehicleType: string | null | undefined,
  idKind: IdDocKind = DEFAULT_ID_DOC_KIND,
  /** « instant » : identité vérifiée par l'IDV → rien à téléverser pour elle. */
  method: KycMethod | null = null
): DriverDocType[] {
  const base: DriverDocType[] = method === "instant" ? [] : [idKind, "selfie"];
  return isMotorized(vehicleType)
    ? [
        ...new Set<DriverDocType>([
          ...base,
          "permis",
          "carte_grise",
          "assurance",
        ]),
      ]
    : base;
}
