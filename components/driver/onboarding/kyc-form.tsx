"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { StepperHeader } from "./stepper-header";

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

/** Les clés d'exigence de `kycReport`, réparties par étape. */
const STEP_KEYS: readonly (readonly string[])[] = [
  ["full_name", "date_of_birth", "phone", "wilaya"],
  ["doc_id", "doc_selfie"],
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
  "Identité",
  "Véhicule",
  "Validation",
];

export function DriverKycForm({ data }: { data: DriverKycData }) {
  const router = useRouter();
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

  const busy = submitting || pendingDocs.length > 0;
  const motorized = isMotorized(profile.vehicle_type);

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

  const report = useMemo(
    () => kycReport(profile, present, idKind),
    [profile, present, idKind]
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

  const steps = STEP_TITLES.map((title, i) => ({
    title,
    complete: i === 3 ? report.complete : stepComplete(i),
  }));

  // REPRISE : on ouvre la première étape encore incomplète. Un livreur qui
  // revient trois jours plus tard retombe exactement là où il s'était arrêté.
  const [step, setStep] = useState(() => {
    const first = [0, 1, 2].find((i) => !stepComplete(i));
    return first ?? 3;
  });

  // Les erreurs ne s'affichent qu'après une tentative d'avancer : on n'accuse
  // pas quelqu'un d'avoir mal rempli un champ qu'il n'a pas encore vu.
  const [showErrors, setShowErrors] = useState(false);

  const errorFor = (key: string): string | null => {
    if (!showErrors) return null;
    const item = itemOf.get(key);
    if (!item || !item.required || item.done) return null;
    return key === "date_of_birth"
      ? "Vous devez avoir au moins 18 ans pour livrer."
      : "Ce champ est obligatoire.";
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

  /** Enregistre puis avance — un pas en avant ne perd jamais la saisie. */
  const onNext = () =>
    startSubmit(async () => {
      if (!stepComplete(step)) {
        setShowErrors(true);
        return;
      }
      if (!(await saveProfile())) return;
      setShowErrors(false);
      setStep((s) => Math.min(s + 1, 3));
    });

  const onBack = () => {
    setShowErrors(false);
    setStep((s) => Math.max(s - 1, 0));
  };

  const onGo = (index: number) => {
    setShowErrors(false);
    setStep(index);
  };

  const onSubmitDossier = () =>
    startSubmit(async () => {
      // On enregistre d'abord la saisie en cours, puis on transmet.
      if (!(await saveProfile())) return;
      const r = await submitDriverDossier();
      if (!r.ok) {
        setError(
          r.missing?.length
            ? `${r.error} Il manque : ${r.missing.join(", ")}.`
            : (r.error ?? "Envoi impossible.")
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
        setError(r.error ?? "Envoi de la pièce impossible.");
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
        setError(r.error ?? "Suppression impossible.");
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
  const idKindLabel =
    ID_DOC_KINDS.find((k) => k.value === idKind)?.label ?? "Pièce d'identité";

  return (
    <div className="space-y-4">
      {/* Dossier refusé : le motif remonte tout en haut, avant tout le reste. */}
      {data.rejectionReason && (
        <div
          className="rounded-[16px] border p-4"
          style={{ borderColor: BRAND_RED, background: "var(--red-soft)" }}
        >
          <b
            className="flex items-center gap-2 text-[14px]"
            style={{ color: BRAND_RED, fontFamily: SORA }}
          >
            <AlertTriangle className="size-4" />
            Dossier à corriger
          </b>
          <p className="mt-1 text-[12.5px] text-[var(--ink)]">
            L&apos;équipe Coligo n&apos;a pas pu valider votre dossier :{" "}
            <b>{data.rejectionReason}</b>
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            Corrigez les éléments concernés puis transmettez-le à nouveau.
          </p>
        </div>
      )}

      <StepperHeader steps={steps} current={step} onGo={onGo} />

      <form
        onSubmit={(e) => e.preventDefault()}
        className="space-y-3 rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-4"
      >
        {step === 0 && (
          <>
            <Field label="Nom complet" required error={errorFor("full_name")}>
              <input
                value={profile.full_name ?? ""}
                onChange={set("full_name")}
                className={inputCls}
                autoComplete="name"
              />
            </Field>
            <Row>
              <Field
                label="Date de naissance"
                required
                hint="18 ans minimum"
                error={errorFor("date_of_birth")}
              >
                <input
                  type="date"
                  value={profile.date_of_birth ?? ""}
                  onChange={set("date_of_birth")}
                  className={inputCls}
                />
              </Field>
              <Field label="Téléphone" required hint="Non modifiable">
                <input
                  value={profile.phone ?? ""}
                  readOnly
                  disabled
                  className={inputCls + " opacity-60"}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Wilaya" required error={errorFor("wilaya")}>
                <select
                  value={profile.wilaya ?? ""}
                  onChange={set("wilaya")}
                  className={inputCls}
                >
                  <option value="">Choisissez…</option>
                  {WILAYAS.map((w, i) => (
                    <option key={w} value={w}>
                      {String(i + 1).padStart(2, "0")} · {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Adresse e-mail">
                <input
                  type="email"
                  value={profile.email ?? ""}
                  onChange={set("email")}
                  className={inputCls}
                  autoComplete="email"
                />
              </Field>
            </Row>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Type de pièce d'identité" required>
              <select
                value={idKind}
                onChange={(e) => onIdKindChange(e.target.value as IdDocKind)}
                disabled={busy}
                className={inputCls}
              >
                {ID_DOC_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>

            <DocSlot
              docType={idKind}
              label={`Photo — ${idKindLabel.toLowerCase()}`}
              doc={docOf(idKind)}
              required
              hint="Lisible, sans reflet, les quatre coins visibles"
              busy={pendingDocs.includes(idKind)}
              error={errorFor("doc_id")}
              onUpload={onUpload}
              onRemove={onRemove}
            />
            <DocSlot
              docType="selfie"
              doc={docOf("selfie")}
              required
              hint="Visage bien visible, sans lunettes de soleil"
              capture
              busy={pendingDocs.includes("selfie")}
              error={errorFor("doc_selfie")}
              onUpload={onUpload}
              onRemove={onRemove}
            />
          </>
        )}

        {step === 2 && (
          <>
            <Field
              label="Type de véhicule"
              required
              error={errorFor("vehicle_type")}
            >
              <select
                value={profile.vehicle_type ?? ""}
                onChange={set("vehicle_type")}
                className={inputCls}
              >
                <option value="">Choisissez…</option>
                {VEHICLE_TYPES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>

            {!profile.vehicle_type && (
              <p className="text-[12px] text-[var(--muted)]">
                Choisissez votre véhicule : les documents demandés en dépendent.
              </p>
            )}

            {profile.vehicle_type && !motorized && (
              <p
                className="rounded-[12px] px-3 py-2 text-[12px] font-semibold"
                style={{ background: "var(--go-soft)", color: BRAND_GO }}
              >
                Véhicule non motorisé : ni permis, ni carte grise, ni assurance
                ne sont demandés.
              </p>
            )}

            {profile.vehicle_type && (
              <>
                <Row>
                  <Field
                    label="Marque"
                    required={motorized}
                    error={errorFor("vehicle_brand")}
                  >
                    <input
                      value={profile.vehicle_brand ?? ""}
                      onChange={set("vehicle_brand")}
                      className={inputCls}
                    />
                  </Field>
                  <Field
                    label="Modèle"
                    required={motorized}
                    error={errorFor("vehicle_model")}
                  >
                    <input
                      value={profile.vehicle_model ?? ""}
                      onChange={set("vehicle_model")}
                      className={inputCls}
                    />
                  </Field>
                </Row>
                <Row>
                  <Field
                    label="Immatriculation"
                    required={motorized}
                    error={errorFor("vehicle_plate")}
                  >
                    <input
                      value={profile.vehicle_plate ?? ""}
                      onChange={set("vehicle_plate")}
                      className={inputCls}
                    />
                  </Field>
                  <Field
                    label="Couleur"
                    required={motorized}
                    error={errorFor("vehicle_color")}
                  >
                    <input
                      value={profile.vehicle_color ?? ""}
                      onChange={set("vehicle_color")}
                      className={inputCls}
                    />
                  </Field>
                </Row>
              </>
            )}

            {motorized && (
              <>
                <DocSlot
                  docType="permis"
                  doc={docOf("permis")}
                  required
                  hint="En cours de validité"
                  busy={pendingDocs.includes("permis")}
                  error={errorFor("doc_permis")}
                  onUpload={onUpload}
                  onRemove={onRemove}
                />
                <DocSlot
                  docType="carte_grise"
                  doc={docOf("carte_grise")}
                  required
                  hint="Du véhicule déclaré ci-dessus"
                  busy={pendingDocs.includes("carte_grise")}
                  error={errorFor("doc_carte_grise")}
                  onUpload={onUpload}
                  onRemove={onRemove}
                />
                <DocSlot
                  docType="assurance"
                  doc={docOf("assurance")}
                  required
                  hint="Attestation en cours de validité"
                  busy={pendingDocs.includes("assurance")}
                  error={errorFor("doc_assurance")}
                  onUpload={onUpload}
                  onRemove={onRemove}
                />
              </>
            )}
          </>
        )}

        {step === 3 && <Review report={report} onGo={onGo} />}
      </form>

      <PartnerInlineError>{error}</PartnerInlineError>

      <div className="space-y-2">
        {step < 3 ? (
          <button
            type="button"
            onClick={onNext}
            disabled={busy}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-extrabold text-white transition-opacity disabled:opacity-40"
            style={{ background: BRAND_VIOLET, fontFamily: SORA }}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            Continuer
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmitDossier}
            disabled={busy || !report.complete}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-extrabold text-white transition-opacity disabled:opacity-40"
            style={{ background: BRAND_VIOLET, fontFamily: SORA }}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            Transmettre mon dossier
          </button>
        )}

        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={onBack}
              disabled={busy}
              className="inline-flex h-[46px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] text-[13.5px] font-bold text-[var(--ink)] disabled:opacity-50"
            >
              <ArrowLeft className="size-3.5" />
              Retour
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="h-[46px] flex-[2] rounded-[14px] border border-[var(--line)] bg-[var(--surface)] text-[13.5px] font-bold text-[var(--ink)] disabled:opacity-50"
          >
            {saved
              ? "✓ Brouillon enregistré"
              : "Enregistrer et continuer plus tard"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Sous-composants ───────────────────────── */

const inputCls =
  "h-[44px] w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[14px] font-medium text-[var(--ink)] outline-none focus:border-[var(--violet)]";

/** Récapitulatif de l'étape 4 : ce qui est prêt, ce qui manque, et où corriger. */
function Review({
  report,
  onGo,
}: {
  report: ReturnType<typeof kycReport>;
  onGo: (index: number) => void;
}) {
  const stepOfKey = (key: string) =>
    STEP_KEYS.findIndex((keys) => keys.includes(key));

  const required = report.sections
    .flatMap((s) => s.items)
    .filter((i) => i.required);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <b
          className="text-[13px] font-bold text-[var(--ink)]"
          style={{ fontFamily: SORA }}
        >
          Avancement du dossier
        </b>
        <span
          className="text-[20px] font-extrabold tabular-nums"
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

      <p className="text-[12px] text-[var(--muted)]">
        {report.complete
          ? "Tout y est. Vous pouvez transmettre votre dossier à l'équipe Coligo."
          : "Touchez un élément manquant pour aller le corriger."}
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
                className="flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-start disabled:cursor-default"
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
                  className="flex-1 text-[12.5px] font-semibold"
                  style={{
                    color: item.done ? "var(--muted)" : "var(--ink)",
                  }}
                >
                  {item.label}
                </span>
                {!item.done && (
                  <span
                    className="text-[11px] font-bold"
                    style={{ color: BRAND_VIOLET }}
                  >
                    Compléter
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
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  /** Message affiché SOUS le champ, jamais dans un bandeau global. */
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-[11.5px] font-bold text-[var(--muted)]">
          {label}
        </span>
        {required ? (
          <span
            className="text-[11px] font-bold"
            style={{ color: BRAND_VIOLET }}
          >
            obligatoire
          </span>
        ) : (
          <span className="text-[11px] text-[var(--muted)]">facultatif</span>
        )}
      </span>
      <span
        className="block rounded-[12px]"
        style={error ? { boxShadow: `0 0 0 2px ${BRAND_RED}` } : undefined}
      >
        {children}
      </span>
      {error ? (
        <span
          role="alert"
          className="mt-1 flex items-center gap-1 text-[11px] font-bold"
          style={{ color: BRAND_RED }}
        >
          <AlertTriangle className="size-3" />
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-[var(--muted)]">
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
  const inputId = `kyc-doc-${docType}`;
  const filled = doc != null;
  return (
    <div
      className="rounded-[14px] border p-3"
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
          className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--surface)]"
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
          <b className="flex items-baseline gap-1.5 text-[13.5px] font-bold text-[var(--ink)]">
            {label ?? DOC_LABELS[docType]}
            <span
              className="text-[10.5px] font-bold"
              style={{ color: required ? BRAND_VIOLET : "var(--muted)" }}
            >
              {required ? "obligatoire" : "facultatif"}
            </span>
          </b>
          <small className="block text-[11.5px] text-[var(--muted)]">
            {busy
              ? "Envoi en cours…"
              : filled
                ? "Reçue — sera vérifiée par l'équipe Coligo"
                : hint}
          </small>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className="cursor-pointer text-[12px] font-bold"
          style={{ color: BRAND_VIOLET, opacity: busy ? 0.5 : 1 }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Upload className="size-3.5" />
            {filled ? "Remplacer" : "Ajouter"}
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
            className="text-[12px] font-bold text-[var(--muted)] underline"
          >
            Voir
          </a>
        )}
        {filled && (
          <button
            type="button"
            onClick={() => onRemove(docType)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold disabled:opacity-50"
            style={{ color: BRAND_RED }}
          >
            <Trash2 className="size-3.5" />
            Retirer
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 flex items-center gap-1 text-[11px] font-bold"
          style={{ color: BRAND_RED }}
        >
          <AlertTriangle className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
