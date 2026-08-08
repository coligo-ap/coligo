"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FileText,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  BRAND_GO,
  BRAND_RED,
  BRAND_VIOLET,
  PartnerInlineError,
  SORA,
} from "@/components/shared/partner-ui";
import { WILAYAS } from "@/lib/dz/wilayas";
import {
  DOC_LABELS,
  ID_DOC_KINDS,
  VEHICLE_TYPES,
  idDocKindOf,
  isMotorized,
  kycReport,
  type DriverDocType,
  type IdDocKind,
  type KycDocs,
  type KycItem,
  type KycMethod,
  type KycProfile,
} from "@/lib/driver/kyc";
import {
  removeDriverKycDocument,
  saveDriverKycProfile,
  submitDriverDossier,
  uploadDriverKycDocument,
  type DriverKycData,
  type KycDocView,
} from "@/app/(driver)/actions";
import { idvGate, type IdvChoiceState } from "@/lib/idv/ui-state";
import {
  IdvPrimaryButton,
  IdvVerifyStep,
} from "@/components/idv/idv-verify-step";
import { setDriverKycMethod } from "@/app/(driver)/actions";
import { StepperHeader } from "./stepper-header";

/** Aucune vérification en jeu (étapes autres que « Vérification ») : le bouton
 *  partagé rend alors simplement le bouton de l'écran. */
const IDV_OFF: IdvChoiceState = {
  available: false,
  forced: false,
  method: null,
  verified: false,
  inProgress: false,
  route: "/driver/identite",
};

/**
 * Dossier de vérification d'identité du livreur, en quatre étapes.
 *
 * Un formulaire long fait abandonner. Il est ici découpé — informations
 * personnelles, identité, véhicule, validation — avec un fil d'Ariane qui dit en
 * permanence où l'on est et ce qu'il reste. Chaque étape s'enregistre : fermer
 * l'application puis revenir ramène à la première étape encore incomplète, avec
 * la saisie intacte.
 *
 * Les règles de complétude viennent de `lib/driver/kyc` — les MÊMES que celles
 * que le serveur ré-applique avant d'accepter le dossier. Jamais deux
 * définitions du « dossier complet ».
 */

/** Les clés d'exigence de `kycReport`, réparties par étape. Selon la méthode
 *  choisie, l'étape « Vérification » exige soit l'identité vérifiée
 *  automatiquement (`idv_verified`), soit les pièces (`doc_id`, `doc_selfie`) :
 *  `kycReport` n'en produit qu'UNE des deux formes — les deux clés cohabitent
 *  donc ici sans jamais être exigées ensemble. */
const STEP_KEYS: readonly (readonly string[])[] = [
  ["full_name", "date_of_birth", "phone", "wilaya"],
  ["idv_verified", "doc_id", "doc_selfie"],
  [
    "vehicle_type",
    "vehicle_brand",
    "vehicle_model",
    "vehicle_plate",
    "vehicle_color",
    "doc_permis",
    "doc_carte_grise",
    "doc_assurance",
  ],
  [],
];

const STEP_TITLES = [
  "Informations personnelles",
  "Vérification",
  "Véhicule",
  "Validation",
];
const STEP_TITLES_AR = ["المعلومات الشخصية", "التحقّق", "المركبة", "المصادقة"];

/** Libellés arabes des données FR de lib/driver/kyc (module pur, non touché). */
const DOC_LABELS_AR: Record<string, string> = {
  cni: "وثيقة الهوية",
  selfie: "صورة لك (سيلفي)",
  permis: "رخصة السياقة",
  carte_grise: "البطاقة الرمادية",
  assurance: "شهادة التأمين",
  passeport: "جواز السفر",
  autre: "وثيقة أخرى",
};
const VEHICLE_LABELS_AR: Record<string, string> = {
  velo: "دراجة هوائية",
  trottinette: "تروتينات",
  moto: "دراجة نارية",
  scooter: "سكوتر",
  voiture: "سيارة",
  camionnette: "شاحنة صغيرة",
};

/**
 * VOLETS : chaque étape se découpe en écrans courts qui TIENNENT SANS
 * DÉFILEMENT (une question à la fois, bouton d'action collé en bas) — le
 * standard des néobanques. Ici : les exigences validées par chaque volet.
 */
const PANE_KEYS: readonly (readonly (readonly string[])[])[] = [
  [["full_name"], ["date_of_birth"], ["wilaya"]],
  [["idv_verified", "doc_id", "doc_selfie"]],
  [
    ["vehicle_type"],
    ["vehicle_brand", "vehicle_model", "vehicle_plate", "vehicle_color"],
    ["doc_permis", "doc_carte_grise", "doc_assurance"],
  ],
  [[]],
];

export function DriverKycForm({ data }: { data: DriverKycData }) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [profile, setProfile] = useState<KycProfile>(data.profile);
  const [docs, setDocs] = useState<KycDocView[]>(data.docs);
  const [submitting, startSubmit] = useTransition();
  // Une pièce en cours d'envoi ne bloque QUE son propre emplacement. Un seul
  // drapeau global gèlerait tous les champs de fichier pendant le
  // rafraîchissement, et les pièces choisies entre-temps seraient ignorées
  // (input `disabled` ⇒ l'évènement `change` n'est jamais émis).
  const [pendingDocs, setPendingDocs] = useState<DriverDocType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // La méthode de vérification est HISSÉE ici : c'est le formulaire qui porte
  // LE bouton d'action (un seul à l'écran), donc c'est lui qui doit savoir si
  // le livreur passe par la voie instantanée ou par le dépôt de pièces.
  // Vérification imposée par l'équipe Coligo ⇒ « instant », sans choix.
  const [idvMethod, setIdvMethod] = useState<KycMethod | null>(
    data.idv.forced ? "instant" : data.idv.method
  );

  const busy = submitting || pendingDocs.length > 0;
  const motorized = isMotorized(profile.vehicle_type);

  /** Porte de vérification — MÊME définition que celle du chauffeur et du
   *  commerçant (components/idv/idv-verify-step) : une seule règle métier. */
  const gate = idvGate(data.idv, idvMethod);

  // Avancement recalculé À CHAQUE FRAPPE à partir des mêmes règles que le
  // serveur (lib/driver/kyc) : jamais deux définitions du « dossier complet ».
  const present = useMemo<KycDocs>(() => {
    const m: KycDocs = {};
    for (const d of docs) m[d.docType] = true;
    return m;
  }, [docs]);

  // La nature de la pièce d'identité se relit de ce qui a été déposé : le choix
  // survit donc à un « continuer plus tard » sans colonne dédiée.
  const [idKind, setIdKind] = useState<IdDocKind>(() =>
    idDocKindOf(
      Object.fromEntries(data.docs.map((d) => [d.docType, true])) as KycDocs
    )
  );

  // Le rapport CLIENT applique EXACTEMENT les mêmes règles que le serveur —
  // méthode de vérification comprise (voie instantanée ⇒ « identité vérifiée »
  // remplace les pièces à téléverser).
  const report = useMemo(
    () =>
      kycReport(profile, present, idKind, {
        method: idvMethod,
        verified: data.idv.verified,
      }),
    [profile, present, idKind, idvMethod, data.idv.verified]
  );

  const itemOf = useMemo(() => {
    const map = new Map<string, KycItem>();
    for (const s of report.sections) for (const i of s.items) map.set(i.key, i);
    return map;
  }, [report]);

  /** Une étape est complète quand toutes ses exigences le sont. */
  const stepComplete = (index: number) =>
    STEP_KEYS[index].every((k) => {
      const item = itemOf.get(k);
      return !item || !item.required || item.done;
    });

  const steps = (isAr ? STEP_TITLES_AR : STEP_TITLES).map((title, i) => ({
    title,
    complete: i === 3 ? report.complete : stepComplete(i),
  }));

  // REPRISE : on ouvre la première étape encore incomplète. Un livreur qui
  // revient trois jours plus tard retombe exactement là où il s'était arrêté.
  const [step, setStep] = useState(() => {
    const first = [0, 1, 2].find((i) => !stepComplete(i));
    return first ?? 3;
  });
  /** Volet courant DANS l'étape (écran court, sans défilement). */
  const [pane, setPane] = useState(0);

  /** Volets réellement affichés pour l'étape : le volet « pièces du véhicule »
   *  n'existe pas pour un vélo (aucune pièce n'est demandée). */
  const panesOf = (index: number): number[] => {
    const all = PANE_KEYS[index].map((_, i) => i);
    if (index !== 2) return all;
    return isMotorized(profile.vehicle_type) ? all : [0, 1];
  };

  const paneComplete = (stepIndex: number, paneIndex: number) =>
    (PANE_KEYS[stepIndex][paneIndex] ?? []).every((k) => {
      const item = itemOf.get(k);
      return !item || !item.required || item.done;
    });

  // Les erreurs ne s'affichent qu'après une tentative d'avancer : on n'accuse
  // pas quelqu'un d'avoir mal rempli un champ qu'il n'a pas encore vu.
  const [showErrors, setShowErrors] = useState(false);

  const errorFor = (key: string): string | null => {
    if (!showErrors) return null;
    const item = itemOf.get(key);
    if (!item || !item.required || item.done) return null;
    return key === "date_of_birth"
      ? tr(
          "Vous devez avoir au moins 18 ans pour livrer.",
          "يجب أن يكون عمرك 18 عامًا على الأقل للتوصيل."
        )
      : tr("Ce champ est obligatoire.", "هذا الحقل إلزامي.");
  };

  const set =
    <K extends keyof KycProfile>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setProfile((p) => ({ ...p, [key]: e.target.value as KycProfile[K] }));
      setSaved(false);
    };

  /**
   * Le formulaire est envoyé depuis l'ÉTAT, jamais depuis le DOM : une étape
   * non affichée est démontée, donc `new FormData(form)` perdrait silencieusement
   * ses champs (le serveur les recevrait à `null`).
   *
   * On n'envoie que les clés que le livreur peut saisir. `address`,
   * `id_card_number`, `national_id_number` et `vehicle_year` ne lui sont plus
   * demandés : absents du `FormData`, le serveur les laisse tels quels au lieu
   * de les effacer.
   */
  const SUBMITTED_KEYS = [
    "full_name",
    "date_of_birth",
    "email",
    "wilaya",
    "vehicle_type",
    "vehicle_brand",
    "vehicle_model",
    "vehicle_plate",
    "vehicle_color",
  ] as const;

  const saveProfile = async (): Promise<boolean> => {
    const fd = new FormData();
    for (const k of SUBMITTED_KEYS) {
      const v = profile[k];
      fd.set(k, v == null ? "" : String(v));
    }
    const r = await saveDriverKycProfile({}, fd);
    if (r.error) {
      setError(r.error);
      return false;
    }
    setError(null);
    setSaved(true);
    return true;
  };

  const onSave = () =>
    startSubmit(async () => {
      if (await saveProfile()) router.refresh();
    });

  /** Enregistre puis avance : d'abord de VOLET en volet (écrans courts), puis
   *  d'étape en étape. Un pas en avant ne perd jamais la saisie. */
  const onNext = () =>
    startSubmit(async () => {
      // Vérification proposée mais pas encore tranchée : on ne laisse pas
      // avancer sans réponse — et on le dit LÀ où se trouve l'action.
      if (step === 1 && data.idv.available && !idvMethod) {
        setError(
          tr(
            "Choisissez comment prouver votre identité.",
            "اختر كيف تُثبت هويتك."
          )
        );
        return;
      }
      // Filet : la porte partagée interdit d'avancer sans identité prouvée.
      if (step === 1 && gate.blocked) return;
      const panes = panesOf(step);
      const at = panes.indexOf(pane);
      const isLastPane = at === panes.length - 1;

      if (!paneComplete(step, pane)) {
        setShowErrors(true);
        return;
      }
      if (!(await saveProfile())) return;
      setShowErrors(false);

      if (!isLastPane) {
        setPane(panes[at + 1]);
        return;
      }
      if (!stepComplete(step)) {
        setShowErrors(true);
        return;
      }
      const next = Math.min(step + 1, 3);
      setStep(next);
      setPane(panesOf(next)[0] ?? 0);
    });

  const onBack = () => {
    setShowErrors(false);
    const panes = panesOf(step);
    const at = panes.indexOf(pane);
    if (at > 0) {
      setPane(panes[at - 1]);
      return;
    }
    const prev = Math.max(step - 1, 0);
    setStep(prev);
    const prevPanes = panesOf(prev);
    setPane(prevPanes[prevPanes.length - 1] ?? 0);
  };

  const onGo = (index: number) => {
    setShowErrors(false);
    setStep(index);
    setPane(panesOf(index)[0] ?? 0);
  };

  const onSubmitDossier = () =>
    startSubmit(async () => {
      // On enregistre d'abord la saisie en cours, puis on transmet.
      if (!(await saveProfile())) return;
      const r = await submitDriverDossier();
      if (!r.ok) {
        setError(
          r.missing?.length
            ? `${r.error} ${tr("Il manque :", "ينقص:")} ${r.missing.join(", ")}.`
            : (r.error ?? tr("Envoi impossible.", "تعذّر الإرسال."))
        );
        return;
      }
      // L'écran d'attente joue l'animation de confirmation à l'arrivée.
      router.replace("/driver/inscription/attente?envoye=1");
    });

  /** Marque/démarque une pièce comme « en cours de traitement ». */
  const mark = (t: DriverDocType, on: boolean) =>
    setPendingDocs((l) => (on ? [...l, t] : l.filter((x) => x !== t)));

  // Pas de `router.refresh()` ici : le serveur renvoie la pièce créée (avec son
  // URL d'aperçu), donc l'écran se met à jour sans re-rendre l'arbre serveur —
  // les champs de fichier ne sont jamais remontés au milieu de la saisie.
  const onUpload = async (docType: DriverDocType, file: File) => {
    mark(docType, true);
    try {
      const fd = new FormData();
      fd.set("doc_type", docType);
      fd.set("file", file);
      const r = await uploadDriverKycDocument(fd);
      if (!r.ok || !r.doc) {
        setError(
          r.error ?? tr("Envoi de la pièce impossible.", "تعذّر إرسال الوثيقة.")
        );
        return;
      }
      setError(null);
      setDocs((list) => [...list.filter((d) => d.docType !== docType), r.doc!]);
    } finally {
      // Verrou toujours relâché, même si l'envoi échoue (cf. règle try/finally).
      mark(docType, false);
    }
  };

  const onRemove = async (docType: DriverDocType) => {
    mark(docType, true);
    try {
      const r = await removeDriverKycDocument(docType);
      if (!r.ok) {
        setError(r.error ?? tr("Suppression impossible.", "تعذّر الحذف."));
        return;
      }
      setDocs((list) => list.filter((d) => d.docType !== docType));
    } finally {
      mark(docType, false);
    }
  };

  /**
   * Changer de nature de pièce retire celle déjà déposée : sans cela, un livreur
   * qui passe de « carte d'identité » à « passeport » laisserait derrière lui une
   * carte d'identité orpheline, que `hasIdDoc` compterait encore comme valide.
   */
  const onIdKindChange = async (next: IdDocKind) => {
    const previous = docs.find((d) => d.docType === idKind);
    setIdKind(next);
    // Un permis exigé par ailleurs (véhicule motorisé) n'est pas retiré.
    const stillNeeded = idKind === "permis" && motorized;
    if (previous && idKind !== next && !stillNeeded) await onRemove(idKind);
  };

  const docOf = (t: DriverDocType) => docs.find((d) => d.docType === t) ?? null;
  const idKindLabel = isAr
    ? (DOC_LABELS_AR[idKind] ?? "وثيقة الهوية")
    : (ID_DOC_KINDS.find((k) => k.value === idKind)?.label ??
      "Pièce d'identité");

  /**
   * LE bouton d'action — il n'y en a qu'UN à l'écran, et son libellé est celui
   * de la prochaine chose à faire. Sur l'étape « Vérification », la logique
   * métier commande : on ne peut PAS avancer tant que l'identité n'est pas
   * vérifiée, donc « Continuer » n'apparaît qu'une fois la vérification faite.
   *   • voie instantanée, rien de fait   → « Vérifier mon identité »
   *   • vérification en cours d'examen   → aucune suite possible : « Actualiser »
   *   • identité vérifiée (ou voie manuelle) → « Continuer »
   */
  const primaryCls =
    "flex h-[52px] w-full items-center justify-center gap-2 rounded-lg text-title-sm font-extrabold text-white transition-opacity disabled:opacity-40";
  const primaryStyle = { background: BRAND_VIOLET, fontFamily: SORA };
  const spinnerOr = (icon: React.ReactNode) =>
    busy ? <Loader2 className="size-4 animate-spin" /> : icon;

  const primary =
    step === 3 ? (
      <button
        type="button"
        onClick={onSubmitDossier}
        disabled={busy || !report.complete}
        className={primaryCls}
        style={primaryStyle}
      >
        {spinnerOr(<ShieldCheck className="size-4" />)}
        {tr("Transmettre mon dossier", "إرسال ملفي")}
      </button>
    ) : (
      // À l'étape « Vérification », le bouton d'action APPARTIENT au système
      // partagé : « Vérifier mon identité » / « Actualiser » tant que la
      // vérification bloque, « Continuer » seulement une fois qu'elle est faite.
      <IdvPrimaryButton
        idv={step === 1 ? data.idv : IDV_OFF}
        method={idvMethod}
        busy={busy}
      >
        <button
          type="button"
          onClick={onNext}
          disabled={busy}
          className={primaryCls}
          style={primaryStyle}
        >
          {spinnerOr(<ArrowRight className="size-4 rtl:rotate-180" />)}
          {tr("Continuer", "متابعة")}
        </button>
      </IdvPrimaryButton>
    );

  return (
    <div className="space-y-4">
      {/* Dossier refusé : le motif remonte tout en haut, avant tout le reste. */}
      {data.rejectionReason && (
        <div
          className="rounded-lg border p-4"
          style={{ borderColor: BRAND_RED, background: "var(--red-soft)" }}
        >
          <b
            className="text-body-lg flex items-center gap-2"
            style={{ color: BRAND_RED, fontFamily: SORA }}
          >
            <AlertTriangle className="size-4" />
            {tr("Dossier à corriger", "ملف بحاجة إلى تصحيح")}
          </b>
          <p className="text-label-lg mt-1 text-[var(--ink)]">
            {tr(
              "L'équipe Coligo n'a pas pu valider votre dossier :",
              "لم يتمكن فريق كوليغو من المصادقة على ملفك:"
            )}{" "}
            <b>{data.rejectionReason}</b>
          </p>
          <p className="text-label mt-1 text-[var(--muted)]">
            {tr(
              "Corrigez les éléments concernés puis transmettez-le à nouveau.",
              "صحّح العناصر المعنية ثم أرسله من جديد."
            )}
          </p>
        </div>
      )}

      <StepperHeader steps={steps} current={step} onGo={onGo} />

      <form
        onSubmit={(e) => e.preventDefault()}
        className="rounded-sheet-lg space-y-3 border border-[var(--line)] bg-[var(--surface)] p-4"
      >
        {step === 0 && pane === 0 && (
          <PaneQuestion
            title={tr("Comment vous appelez-vous ?", "ما اسمك؟")}
            hint={tr(
              "Tel qu'il figure sur votre pièce d'identité.",
              "كما هو مكتوب في وثيقة هويتك."
            )}
          >
            <Field
              label={tr("Nom complet", "الاسم الكامل")}
              required
              error={errorFor("full_name")}
            >
              <input
                value={profile.full_name ?? ""}
                onChange={set("full_name")}
                className={bigInputCls}
                autoComplete="name"
                placeholder={tr("Prénom et nom", "الاسم واللقب")}
              />
            </Field>
            <Field
              label={tr("Téléphone", "الهاتف")}
              locked
              hint={tr("Votre identifiant de connexion", "معرّف تسجيل دخولك")}
            >
              <input
                value={profile.phone ?? ""}
                readOnly
                disabled
                className={bigInputCls + " opacity-60"}
              />
            </Field>
          </PaneQuestion>
        )}

        {step === 0 && pane === 1 && (
          <PaneQuestion
            title={tr(
              "Quelle est votre date de naissance ?",
              "ما هو تاريخ ميلادك؟"
            )}
            hint={tr(
              "Vous devez avoir au moins 18 ans pour livrer.",
              "يجب أن يكون عمرك 18 عامًا على الأقل للتوصيل."
            )}
          >
            <Field
              label={tr("Date de naissance", "تاريخ الميلاد")}
              required
              error={errorFor("date_of_birth")}
            >
              <input
                type="date"
                value={profile.date_of_birth ?? ""}
                onChange={set("date_of_birth")}
                className={bigInputCls}
              />
            </Field>
          </PaneQuestion>
        )}

        {step === 0 && pane === 2 && (
          <PaneQuestion
            title={tr("Où livrez-vous ?", "أين توصّل؟")}
            hint={tr(
              "Votre wilaya détermine les commerçants qui vous seront proposés.",
              "ولايتك تحدّد التجار الذين سيُقترحون عليك."
            )}
          >
            <Field
              label={tr("Wilaya", "الولاية")}
              required
              error={errorFor("wilaya")}
            >
              <select
                value={profile.wilaya ?? ""}
                onChange={set("wilaya")}
                className={bigInputCls}
              >
                <option value="">{tr("Choisissez…", "اختر…")}</option>
                {WILAYAS.map((w, i) => (
                  <option key={w} value={w}>
                    {String(i + 1).padStart(2, "0")} · {w}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={tr("Adresse e-mail", "البريد الإلكتروني")}
              hint={tr("Facultatif", "اختياري")}
            >
              <input
                type="email"
                value={profile.email ?? ""}
                onChange={set("email")}
                className={bigInputCls}
                autoComplete="email"
                placeholder={tr("vous@exemple.com", "you@example.com")}
              />
            </Field>
          </PaneQuestion>
        )}
        {step === 1 && (
          <IdvVerifyStep
            idv={data.idv}
            method={idvMethod}
            saveMethod={setDriverKycMethod}
            onMethod={(m) => {
              setIdvMethod(m);
              setShowErrors(false);
              setError(null);
            }}
          >
            <>
              <>
                <Field
                  label={tr("Type de pièce d'identité", "نوع وثيقة الهوية")}
                  required
                >
                  <select
                    value={idKind}
                    onChange={(e) =>
                      onIdKindChange(e.target.value as IdDocKind)
                    }
                    disabled={busy}
                    className={inputCls}
                  >
                    {ID_DOC_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {isAr ? (DOC_LABELS_AR[k.value] ?? k.label) : k.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <DocSlot
                  docType={idKind}
                  label={
                    isAr
                      ? `صورة — ${idKindLabel}`
                      : `Photo — ${idKindLabel.toLowerCase()}`
                  }
                  doc={docOf(idKind)}
                  required
                  hint={tr(
                    "Lisible, sans reflet, les quatre coins visibles",
                    "مقروءة، بلا انعكاس، والزوايا الأربع ظاهرة"
                  )}
                  busy={pendingDocs.includes(idKind)}
                  error={errorFor("doc_id")}
                  onUpload={onUpload}
                  onRemove={onRemove}
                />
                <DocSlot
                  docType="selfie"
                  doc={docOf("selfie")}
                  required
                  hint={tr(
                    "Visage bien visible, sans lunettes de soleil",
                    "الوجه ظاهر جيدًا، دون نظارات شمسية"
                  )}
                  capture
                  busy={pendingDocs.includes("selfie")}
                  error={errorFor("doc_selfie")}
                  onUpload={onUpload}
                  onRemove={onRemove}
                />
              </>
            </>
          </IdvVerifyStep>
        )}

        {step === 2 && pane === 0 && (
          <PaneQuestion
            title={tr("Avec quoi livrez-vous ?", "بماذا توصّل؟")}
            hint={tr(
              "Les pièces demandées ensuite dépendent de votre véhicule.",
              "الوثائق المطلوبة لاحقًا تعتمد على مركبتك."
            )}
          >
            <div className="grid grid-cols-2 gap-2">
              {VEHICLE_TYPES.map((v) => {
                const active = profile.vehicle_type === v.value;
                return (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() =>
                      setProfile((p) => ({ ...p, vehicle_type: v.value }))
                    }
                    className="rounded-lg border p-3.5 text-start transition-colors"
                    style={{
                      borderColor: active ? BRAND_VIOLET : "var(--line)",
                      background: active
                        ? "rgba(108,43,217,.06)"
                        : "var(--surface)",
                      boxShadow: active
                        ? `0 0 0 1px ${BRAND_VIOLET} inset`
                        : undefined,
                    }}
                  >
                    <p className="text-body-lg font-bold">
                      {isAr ? (VEHICLE_LABELS_AR[v.value] ?? v.label) : v.label}
                    </p>
                    <p className="text-caption mt-0.5 text-[var(--muted)]">
                      {v.motorized
                        ? tr(
                            "Permis, carte grise, assurance",
                            "رخصة، بطاقة رمادية، تأمين"
                          )
                        : tr("Aucune pièce véhicule", "لا وثائق للمركبة")}
                    </p>
                  </button>
                );
              })}
            </div>
            {showErrors && errorFor("vehicle_type") && (
              <p className="text-label font-semibold text-red-600">
                {tr("Choisissez votre véhicule.", "اختر مركبتك.")}
              </p>
            )}
          </PaneQuestion>
        )}

        {step === 2 && pane === 1 && (
          <PaneQuestion
            title={tr("Votre véhicule", "مركبتك")}
            hint={tr(
              "Ces informations figurent sur la carte grise.",
              "هذه المعلومات موجودة على البطاقة الرمادية."
            )}
          >
            <Row>
              <Field
                label={tr("Marque", "العلامة")}
                required={motorized}
                error={errorFor("vehicle_brand")}
              >
                <input
                  value={profile.vehicle_brand ?? ""}
                  onChange={set("vehicle_brand")}
                  className={bigInputCls}
                />
              </Field>
              <Field
                label={tr("Modèle", "الطراز")}
                required={motorized}
                error={errorFor("vehicle_model")}
              >
                <input
                  value={profile.vehicle_model ?? ""}
                  onChange={set("vehicle_model")}
                  className={bigInputCls}
                />
              </Field>
            </Row>
            <Row>
              <Field
                label={tr("Immatriculation", "لوحة الترقيم")}
                required={motorized}
                error={errorFor("vehicle_plate")}
              >
                <input
                  value={profile.vehicle_plate ?? ""}
                  onChange={set("vehicle_plate")}
                  className={bigInputCls}
                />
              </Field>
              <Field
                label={tr("Couleur", "اللون")}
                required={motorized}
                error={errorFor("vehicle_color")}
              >
                <input
                  value={profile.vehicle_color ?? ""}
                  onChange={set("vehicle_color")}
                  className={bigInputCls}
                />
              </Field>
            </Row>
          </PaneQuestion>
        )}

        {step === 2 && pane === 2 && (
          <PaneQuestion
            title={tr("Pièces du véhicule", "وثائق المركبة")}
            hint={tr(
              "Photos nettes, documents en cours de validité.",
              "صور واضحة، ووثائق سارية الصلاحية."
            )}
          >
            <DocSlot
              docType="permis"
              doc={docOf("permis")}
              required
              hint={tr("En cours de validité", "سارية الصلاحية")}
              busy={pendingDocs.includes("permis")}
              error={errorFor("doc_permis")}
              onUpload={onUpload}
              onRemove={onRemove}
            />
            <DocSlot
              docType="carte_grise"
              doc={docOf("carte_grise")}
              required
              hint={tr("Du véhicule déclaré", "للمركبة المصرَّح بها")}
              busy={pendingDocs.includes("carte_grise")}
              error={errorFor("doc_carte_grise")}
              onUpload={onUpload}
              onRemove={onRemove}
            />
            <DocSlot
              docType="assurance"
              doc={docOf("assurance")}
              required
              hint={tr(
                "Attestation en cours de validité",
                "شهادة سارية الصلاحية"
              )}
              busy={pendingDocs.includes("assurance")}
              error={errorFor("doc_assurance")}
              onUpload={onUpload}
              onRemove={onRemove}
            />
          </PaneQuestion>
        )}

        {step === 3 && <Review report={report} onGo={onGo} />}
      </form>

      <PartnerInlineError>{error}</PartnerInlineError>

      {/* BARRE D'ACTION collée en bas : le bouton reste sous le pouce sans
          jamais avoir à faire défiler l'écran. UN SEUL bouton principal, et il
          dit exactement ce qui se passe ensuite (règle métier : on ne « continue »
          pas tant que l'identité n'est pas vérifiée — le bouton est alors
          « Vérifier mon identité », pas « Continuer »). */}
      <div
        className="sticky bottom-0 -mx-5 space-y-2 border-t border-[var(--line)] bg-[var(--d-page)]/95 px-5 pt-3 backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        {primary}

        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={onBack}
              disabled={busy}
              className="rounded-card-lg text-body inline-flex h-[46px] flex-1 items-center justify-center gap-1.5 border border-[var(--line)] bg-[var(--surface)] font-bold text-[var(--ink)] disabled:opacity-50"
            >
              <ArrowLeft className="size-3.5 rtl:rotate-180" />
              {tr("Retour", "رجوع")}
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="rounded-card-lg text-body h-[46px] flex-[2] border border-[var(--line)] bg-[var(--surface)] font-bold text-[var(--ink)] disabled:opacity-50"
          >
            {saved
              ? tr("✓ Brouillon enregistré", "✓ حُفظت المسودة")
              : tr("Enregistrer et reprendre plus tard", "احفظ وتابع لاحقًا")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Sous-composants ───────────────────────── */

const inputCls =
  "h-[44px] w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-body-lg font-medium text-[var(--ink)] outline-none focus:border-[var(--violet)]";

/** Champs GÉNÉREUX (cibles tactiles confortables, style néobanque). */
const bigInputCls =
  "h-[52px] w-full rounded-card-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 text-title-sm font-medium text-[var(--ink)] outline-none focus:border-[var(--violet)]";

/** Volet = UNE question, quelques champs, rien d'autre : l'écran tient sans
 *  défilement, même sur un petit téléphone. */
function PaneQuestion({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2
          className="text-heading leading-tight font-extrabold tracking-[-0.4px]"
          style={{ fontFamily: SORA }}
        >
          {title}
        </h2>
        {hint && (
          <p className="text-label-lg mt-1 text-[var(--muted)]">{hint}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/** Récapitulatif de l'étape 4 : ce qui est prêt, ce qui manque, et où corriger. */
function Review({
  report,
  onGo,
}: {
  report: ReturnType<typeof kycReport>;
  onGo: (index: number) => void;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const stepOfKey = (key: string) =>
    STEP_KEYS.findIndex((keys) => keys.includes(key));

  const required = report.sections
    .flatMap((s) => s.items)
    .filter((i) => i.required);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <b
          className="text-body-sm font-bold text-[var(--ink)]"
          style={{ fontFamily: SORA }}
        >
          {tr("Avancement du dossier", "تقدّم الملف")}
        </b>
        <span
          className="text-heading-lg font-extrabold tabular-nums"
          style={{
            fontFamily: SORA,
            color: report.complete ? BRAND_GO : BRAND_VIOLET,
          }}
        >
          {report.percent}%
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-[var(--soft)]">
        <i
          className="block h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(3, report.percent)}%`,
            background: report.complete ? BRAND_GO : BRAND_VIOLET,
          }}
        />
      </div>

      <p className="text-label text-[var(--muted)]">
        {report.complete
          ? tr(
              "Tout y est. Vous pouvez transmettre votre dossier à l'équipe Coligo.",
              "كل شيء جاهز. يمكنك إرسال ملفك إلى فريق كوليغو."
            )
          : tr(
              "Touchez un élément manquant pour aller le corriger.",
              "المس أي عنصر ناقص للانتقال إلى تصحيحه."
            )}
      </p>

      <ul className="space-y-1.5">
        {required.map((item) => {
          const target = stepOfKey(item.key);
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => target >= 0 && onGo(target)}
                disabled={item.done || target < 0}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start disabled:cursor-default"
                style={{
                  background: item.done ? "transparent" : "var(--soft)",
                }}
              >
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-full"
                  style={{
                    background: item.done ? BRAND_GO : "var(--surface)",
                    color: item.done ? "#fff" : "var(--muted)",
                    border: item.done ? undefined : "1px solid var(--line)",
                  }}
                >
                  {item.done && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span
                  className="text-label-lg flex-1 font-semibold"
                  style={{
                    color: item.done ? "var(--muted)" : "var(--ink)",
                  }}
                >
                  {item.label}
                </span>
                {!item.done && (
                  <span
                    className="text-caption font-bold"
                    style={{ color: BRAND_VIOLET }}
                  >
                    {tr("Compléter", "استكمال")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Field({
  label,
  required,
  locked,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  /** Champ en lecture seule (téléphone de connexion) : ni « obligatoire » ni
   *  « facultatif » — on ne peut pas le remplir, la mention n'a aucun sens. */
  locked?: boolean;
  hint?: string;
  /** Message affiché SOUS le champ, jamais dans un bandeau global. */
  error?: string | null;
  children: React.ReactNode;
}) {
  const isAr = useLocale() === "ar";
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-caption-lg font-bold text-[var(--muted)]">
          {label}
        </span>
        {locked ? null : required ? (
          <span
            className="text-caption font-bold"
            style={{ color: BRAND_VIOLET }}
          >
            {isAr ? "إلزامي" : "obligatoire"}
          </span>
        ) : (
          <span className="text-caption text-[var(--muted)]">
            {isAr ? "اختياري" : "facultatif"}
          </span>
        )}
      </span>
      <span
        className="block rounded-md"
        style={error ? { boxShadow: `0 0 0 2px ${BRAND_RED}` } : undefined}
      >
        {children}
      </span>
      {error ? (
        <span
          role="alert"
          className="text-caption mt-1 flex items-center gap-1 font-bold"
          style={{ color: BRAND_RED }}
        >
          <AlertTriangle className="size-3" />
          {error}
        </span>
      ) : hint ? (
        <span className="text-caption mt-1 block text-[var(--muted)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** Emplacement d'une pièce : dépôt, aperçu, remplacement, retrait. */
function DocSlot({
  docType,
  label,
  doc,
  required,
  hint,
  capture,
  busy,
  error,
  onUpload,
  onRemove,
}: {
  docType: DriverDocType;
  /** Remplace le libellé par défaut (la pièce d'identité change de nature). */
  label?: string;
  doc: KycDocView | null;
  required: boolean;
  hint: string;
  capture?: boolean;
  busy: boolean;
  error?: string | null;
  onUpload: (t: DriverDocType, f: File) => void;
  onRemove: (t: DriverDocType) => void;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const inputId = `kyc-doc-${docType}`;
  const filled = doc != null;
  return (
    <div
      className="rounded-card-lg border p-3"
      style={{
        borderColor: error
          ? BRAND_RED
          : filled
            ? "rgba(22,179,100,.35)"
            : "var(--line)",
        background: filled ? "var(--go-soft)" : "var(--soft)",
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--surface)]"
          style={{ color: filled ? BRAND_GO : BRAND_VIOLET }}
        >
          {busy ? (
            <Loader2 className="size-4.5 animate-spin" />
          ) : filled ? (
            <Check className="size-4.5" strokeWidth={3} />
          ) : capture ? (
            <Camera className="size-4.5" />
          ) : (
            <FileText className="size-4.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <b className="text-body flex items-baseline gap-1.5 font-bold text-[var(--ink)]">
            {label ??
              (isAr
                ? (DOC_LABELS_AR[docType] ?? DOC_LABELS[docType])
                : DOC_LABELS[docType])}
            <span
              className="text-micro-lg font-bold"
              style={{ color: required ? BRAND_VIOLET : "var(--muted)" }}
            >
              {required
                ? tr("obligatoire", "إلزامي")
                : tr("facultatif", "اختياري")}
            </span>
          </b>
          <small className="text-caption-lg block text-[var(--muted)]">
            {busy
              ? tr("Envoi en cours…", "جارٍ الإرسال…")
              : filled
                ? tr(
                    "Reçue — sera vérifiée par l'équipe Coligo",
                    "استُلمت — سيتحقق منها فريق كوليغو"
                  )
                : hint}
          </small>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className="text-label cursor-pointer font-bold"
          style={{ color: BRAND_VIOLET, opacity: busy ? 0.5 : 1 }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Upload className="size-3.5" />
            {filled ? tr("Remplacer", "استبدال") : tr("Ajouter", "إضافة")}
          </span>
        </label>
        <input
          id={inputId}
          type="file"
          hidden
          disabled={busy}
          accept={
            capture
              ? "image/jpeg,image/png,image/webp"
              : "image/jpeg,image/png,image/webp,application/pdf"
          }
          {...(capture ? { capture: "user" as const } : {})}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onUpload(docType, f);
          }}
        />
        {doc?.scanUrl && (
          <a
            href={doc.scanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-label font-bold text-[var(--muted)] underline"
          >
            {tr("Voir", "عرض")}
          </a>
        )}
        {filled && (
          <button
            type="button"
            onClick={() => onRemove(docType)}
            disabled={busy}
            className="text-label inline-flex items-center gap-1.5 font-bold disabled:opacity-50"
            style={{ color: BRAND_RED }}
          >
            <Trash2 className="size-3.5" />
            {tr("Retirer", "إزالة")}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="text-caption mt-2 flex items-center gap-1 font-bold"
          style={{ color: BRAND_RED }}
        >
          <AlertTriangle className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
