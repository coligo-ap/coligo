"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
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
  VEHICLE_TYPES,
  isMotorized,
  kycReport,
  type DriverDocType,
  type KycDocs,
  type KycProfile,
  type KycSection,
} from "@/lib/driver/kyc";
import {
  removeDriverKycDocument,
  saveDriverKycProfile,
  submitDriverDossier,
  uploadDriverKycDocument,
  type DriverKycData,
  type KycDocView,
} from "@/app/(driver)/actions";

/**
 * Dossier de vérification d'identité du livreur (étape 2 du parcours).
 *
 * Deux sections indépendantes en listes ouvrantes/fermantes : « Informations
 * personnelles » et « Véhicule ». Chacune affiche son avancement, ce qui est
 * obligatoire, ce qui est facultatif, et ce qui manque encore. L'envoi reste
 * verrouillé tant qu'un élément obligatoire est absent — et le serveur refait
 * exactement le même contrôle avant d'accepter le dossier.
 */
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
  const [open, setOpen] = useState<"personal" | "vehicle" | null>("personal");

  const busy = submitting || pendingDocs.length > 0;

  const motorized = isMotorized(profile.vehicle_type);

  // Avancement recalculé À CHAQUE FRAPPE à partir des mêmes règles que le
  // serveur (lib/driver/kyc) : jamais deux définitions du « dossier complet ».
  const present = useMemo<KycDocs>(() => {
    const m: KycDocs = {};
    for (const d of docs) m[d.docType] = true;
    return m;
  }, [docs]);
  const report = useMemo(() => kycReport(profile, present), [profile, present]);

  const set =
    <K extends keyof KycProfile>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const raw = e.target.value;
      setProfile((p) => ({
        ...p,
        [key]: (key === "vehicle_year"
          ? raw === ""
            ? null
            : Number(raw)
          : raw) as KycProfile[K],
      }));
      setSaved(false);
    };

  /**
   * Le formulaire est envoyé depuis l'ÉTAT, jamais depuis le DOM : une section
   * repliée est démontée, donc `new FormData(form)` perdrait silencieusement
   * tous ses champs (le serveur les recevrait à `null`).
   */
  const saveProfile = async (): Promise<boolean> => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(profile)) {
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

  const personal = report.sections[0];
  const vehicle = report.sections[1];
  const docOf = (t: DriverDocType) => docs.find((d) => d.docType === t) ?? null;

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

      <GlobalProgress percent={report.percent} missing={report.missing} />

      <form onSubmit={(e) => e.preventDefault()}>
        <Accordion
          section={personal}
          open={open === "personal"}
          onToggle={() => setOpen(open === "personal" ? null : "personal")}
        >
          <Field label="Nom complet" required>
            <input
              name="full_name"
              value={profile.full_name ?? ""}
              onChange={set("full_name")}
              className={inputCls}
              autoComplete="name"
            />
          </Field>
          <Row>
            <Field label="Date de naissance" required hint="18 ans minimum">
              <input
                type="date"
                name="date_of_birth"
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
            <Field label="Wilaya" required>
              <select
                name="wilaya"
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
                name="email"
                value={profile.email ?? ""}
                onChange={set("email")}
                className={inputCls}
                autoComplete="email"
              />
            </Field>
          </Row>
          <Field label="Adresse" required>
            <input
              name="address"
              value={profile.address ?? ""}
              onChange={set("address")}
              className={inputCls}
              placeholder="Rue, quartier, commune"
            />
          </Field>
          <Row>
            <Field label="N° de pièce d'identité" required>
              <input
                name="id_card_number"
                value={profile.id_card_number ?? ""}
                onChange={set("id_card_number")}
                className={inputCls}
              />
            </Field>
            <Field label="Numéro national (NIN)">
              <input
                name="national_id_number"
                value={profile.national_id_number ?? ""}
                onChange={set("national_id_number")}
                className={inputCls}
              />
            </Field>
          </Row>

          <DocSlot
            docType="cni"
            doc={docOf("cni")}
            required
            hint="Recto lisible, sans reflet"
            busy={pendingDocs.includes("cni")}
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
            onUpload={onUpload}
            onRemove={onRemove}
          />
        </Accordion>

        <Accordion
          section={vehicle}
          open={open === "vehicle"}
          onToggle={() => setOpen(open === "vehicle" ? null : "vehicle")}
        >
          <Field label="Type de véhicule" required>
            <select
              name="vehicle_type"
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
              Véhicule non motorisé : ni permis, ni carte grise, ni assurance ne
              sont demandés.
            </p>
          )}

          {profile.vehicle_type && (
            <>
              <Row>
                <Field label="Marque" required={motorized}>
                  <input
                    name="vehicle_brand"
                    value={profile.vehicle_brand ?? ""}
                    onChange={set("vehicle_brand")}
                    className={inputCls}
                  />
                </Field>
                <Field label="Modèle" required={motorized}>
                  <input
                    name="vehicle_model"
                    value={profile.vehicle_model ?? ""}
                    onChange={set("vehicle_model")}
                    className={inputCls}
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Immatriculation" required={motorized}>
                  <input
                    name="vehicle_plate"
                    value={profile.vehicle_plate ?? ""}
                    onChange={set("vehicle_plate")}
                    className={inputCls}
                  />
                </Field>
                <Field label="Couleur">
                  <input
                    name="vehicle_color"
                    value={profile.vehicle_color ?? ""}
                    onChange={set("vehicle_color")}
                    className={inputCls}
                  />
                </Field>
              </Row>
              <Field label="Année de mise en circulation">
                <input
                  type="number"
                  name="vehicle_year"
                  min={1970}
                  max={new Date().getFullYear()}
                  value={profile.vehicle_year ?? ""}
                  onChange={set("vehicle_year")}
                  className={inputCls}
                />
              </Field>
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
                onUpload={onUpload}
                onRemove={onRemove}
              />
              <DocSlot
                docType="carte_grise"
                doc={docOf("carte_grise")}
                required
                hint="Du véhicule déclaré ci-dessus"
                busy={pendingDocs.includes("carte_grise")}
                onUpload={onUpload}
                onRemove={onRemove}
              />
              <DocSlot
                docType="assurance"
                doc={docOf("assurance")}
                required
                hint="Attestation en cours de validité"
                busy={pendingDocs.includes("assurance")}
                onUpload={onUpload}
                onRemove={onRemove}
              />
            </>
          )}
        </Accordion>
      </form>

      <PartnerInlineError>{error}</PartnerInlineError>

      <div className="space-y-2">
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
        {!report.complete && (
          <p className="text-center text-[12px] text-[var(--muted)]">
            Complétez les éléments obligatoires pour pouvoir transmettre.
          </p>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="h-[46px] w-full rounded-[14px] border border-[var(--line)] bg-[var(--surface)] text-[13.5px] font-bold text-[var(--ink)] disabled:opacity-50"
        >
          {saved
            ? "✓ Brouillon enregistré"
            : "Enregistrer et continuer plus tard"}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Sous-composants ───────────────────────── */

const inputCls =
  "h-[44px] w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[14px] font-medium text-[var(--ink)] outline-none focus:border-[var(--violet)]";

function GlobalProgress({
  percent,
  missing,
}: {
  percent: number;
  missing: string[];
}) {
  const done = missing.length === 0;
  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-baseline justify-between">
        <b
          className="text-[13px] font-bold text-[var(--ink)]"
          style={{ fontFamily: SORA }}
        >
          Avancement du dossier
        </b>
        <span
          className="text-[20px] font-extrabold tabular-nums"
          style={{ fontFamily: SORA, color: done ? BRAND_GO : BRAND_VIOLET }}
        >
          {percent}%
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--soft)]">
        <i
          className="block h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(3, percent)}%`,
            background: done ? BRAND_GO : BRAND_VIOLET,
          }}
        />
      </div>
      {/* Le DÉTAIL de ce qui manque est affiché section par section, là où on le
          corrige. Ici, seule la vue d'ensemble. */}
      <p className="mt-2 text-[12px] text-[var(--muted)]">
        {done
          ? "Tout y est. Vous pouvez transmettre votre dossier à l'équipe Coligo."
          : `${missing.length} élément${missing.length > 1 ? "s" : ""} obligatoire${
              missing.length > 1 ? "s" : ""
            } à compléter, répartis dans les sections ci-dessous.`}
      </p>
    </div>
  );
}

function Accordion({
  section,
  open,
  onToggle,
  children,
}: {
  section: KycSection;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-4 text-start"
      >
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{
            background: section.complete ? "var(--go-soft)" : "var(--soft)",
            color: section.complete ? BRAND_GO : "var(--muted)",
          }}
        >
          {section.complete ? (
            <Check className="size-4" strokeWidth={3} />
          ) : (
            <span className="text-[11px] font-extrabold tabular-nums">
              {section.percent}%
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <b
            className="block text-[14.5px] font-extrabold text-[var(--ink)]"
            style={{ fontFamily: SORA }}
          >
            {section.title}
          </b>
          <small className="block truncate text-[11.5px] text-[var(--muted)]">
            {section.complete
              ? "Section complète"
              : `Manquant : ${section.missing.join(" · ")}`}
          </small>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-[var(--muted)] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
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
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
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
      {children}
      {hint && (
        <span className="mt-1 block text-[11px] text-[var(--muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}

/** Emplacement d'une pièce : dépôt, aperçu, remplacement, retrait. */
function DocSlot({
  docType,
  doc,
  required,
  hint,
  capture,
  busy,
  onUpload,
  onRemove,
}: {
  docType: DriverDocType;
  doc: KycDocView | null;
  required: boolean;
  hint: string;
  capture?: boolean;
  busy: boolean;
  onUpload: (t: DriverDocType, f: File) => void;
  onRemove: (t: DriverDocType) => void;
}) {
  const inputId = `kyc-doc-${docType}`;
  const filled = doc != null;
  return (
    <div
      className="rounded-[14px] border p-3"
      style={{
        borderColor: filled ? "rgba(22,179,100,.35)" : "var(--line)",
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
            {DOC_LABELS[docType]}
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
    </div>
  );
}
