"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  Camera,
  ChevronLeft,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  VIOLET,
  GO,
  RED,
  PrimaryBtn,
} from "@/components/customer/drive/drive-modals";
import {
  deleteChauffeurDoc,
  getChauffeurDocs,
  setChauffeurKycMethod,
  submitChauffeurDossier,
  uploadChauffeurDoc,
  type ChauffeurDocInfo,
  type ChauffeurIdvState,
  type DocKind,
} from "@/app/(chauffeur)/actions";
import type { IdvMethod } from "@/lib/idv/ui-state";
import {
  IdvPrimaryButton,
  IdvVerifyStep,
} from "@/components/idv/idv-verify-step";

const DOCS: {
  kind: DocKind;
  title: string;
  titleAr: string;
  sub: string;
  subAr: string;
  required: boolean;
}[] = [
  {
    kind: "permis_recto",
    title: "Permis de conduire (recto)",
    titleAr: "رخصة السياقة (الوجه الأمامي)",
    sub: "Photo nette du recto",
    subAr: "صورة واضحة للوجه الأمامي",
    required: true,
  },
  {
    kind: "permis_verso",
    title: "Permis de conduire (verso)",
    titleAr: "رخصة السياقة (الوجه الخلفي)",
    sub: "Photo nette du verso",
    subAr: "صورة واضحة للوجه الخلفي",
    required: true,
  },
  {
    kind: "carte_grise",
    title: "Carte grise",
    titleAr: "البطاقة الرمادية",
    sub: "Du véhicule déclaré",
    subAr: "للمركبة المصرَّح بها",
    required: true,
  },
  {
    kind: "plaque",
    title: "Immatriculation",
    titleAr: "لوحة الترقيم",
    sub: "Photo de la plaque du véhicule",
    subAr: "صورة لوحة المركبة",
    required: true,
  },
  {
    kind: "assurance",
    title: "Assurance",
    titleAr: "التأمين",
    sub: "Si disponible",
    subAr: "إن وُجد",
    required: false,
  },
];

/**
 * Compression côté client : les photos téléphone font 3-8 Mo ; on les
 * redimensionne (max 1600 px) et ré-encode en JPEG avant l'envoi au serveur
 * (action limitée en taille + upload bien plus rapide en 3G/4G). Si l'image
 * ne peut pas être décodée (format exotique), on renvoie le fichier original.
 */
async function compressImage(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82)
    );
    if (!blob) return file;
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Documents du véhicule + IDENTITÉ du chauffeur.
 *
 * L'identité se prouve par l'UN des deux chemins — le MÊME système que le
 * livreur et le commerçant (components/idv/idv-verify-step) :
 *   • vérification INSTANTANÉE (scan du document + selfie analysés en secondes) ;
 *   • vérification MANUELLE (selfie en direct, examiné par l'équipe Coligo).
 * Le selfie en direct ne passe QUE par la caméra (aucun import de fichier).
 * Un seul bouton d'action à l'écran : tant que la vérification bloque, il dit
 * « Vérifier mon identité » ; « Envoyer mon dossier » n'apparaît qu'après.
 */
export function DDocs({
  rejectedReason,
  idv,
}: {
  rejectedReason?: string | null;
  idv: ChauffeurIdvState;
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [method, setMethod] = useState<IdvMethod | null>(
    idv.forced ? "instant" : idv.method
  );
  const [docs, setDocs] = useState<Record<string, ChauffeurDocInfo>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DocKind | null>(null);

  const refresh = useCallback(async () => {
    const list = await getChauffeurDocs();
    const map: Record<string, ChauffeurDocInfo> = {};
    for (const d of list) map[d.kind] = d;
    setDocs(map);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = async (kind: DocKind, raw: File) => {
    setBusy(kind);
    setError(null);
    const file = await compressImage(raw);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    const res = await uploadChauffeurDoc(fd);
    if (res.ok) await refresh();
    else setError(res.error ?? tr("Envoi impossible", "تعذّر الإرسال"));
    setBusy(null);
  };

  // Suppression confirmée par un MODAL designé (plus de window.confirm).
  const remove = (kind: DocKind) => setConfirmDelete(kind);
  const doRemove = async (kind: DocKind) => {
    setConfirmDelete(null);
    setBusy(kind);
    setError(null);
    const res = await deleteChauffeurDoc(kind);
    if (res.ok) await refresh();
    else setError(res.error ?? tr("Suppression impossible", "تعذّر الحذف"));
    setBusy(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const res = await submitChauffeurDossier();
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? tr("Dossier incomplet", "ملف غير مكتمل"));
      return;
    }
    router.replace("/chauffeur");
  };

  const selfie = docs.selfie;

  // ── Dossier ENTIÈREMENT validé ? ──
  // Anti-fraude : une pièce validée ne se remplace ni ne se supprime côté
  // chauffeur. Et si TOUT le dossier est validé (véhicule + identité, sans
  // refus en attente), on n'affiche plus la liste : un simple message
  // « documents à jour ». Le seul chemin de modification redevient la
  // « demande de modification » de l'équipe Coligo (rejet avec motif), qui
  // ré-affiche la liste.
  const identityOk = idv.verified || selfie?.status === "approved";
  const vehicleDocsApproved = DOCS.every((d) => {
    const info = docs[d.kind];
    if (!info) return !d.required; // optionnel absent = OK
    return info.status === "approved";
  });
  const allValidated = Boolean(
    vehicleDocsApproved && identityOk && !rejectedReason
  );

  /** Voie MANUELLE : le selfie en direct (caméra seule, aucun import possible).
   *  Passé en enfant de l'étape de vérification partagée — il ne s'affiche que
   *  si c'est bien le chemin retenu. */
  const selfieSection = (
    <div className="text-center">
      <p className="text-[13.5px] font-bold">
        {tr("Photo de votre visage · en direct", "صورة وجهك · مباشرة")}{" "}
        <span style={{ color: RED }}>*</span>
      </p>
      <div
        className="mx-auto my-2.5 grid size-32 place-items-center overflow-hidden rounded-full border-[3px]"
        style={
          selfie
            ? { borderColor: GO }
            : {
                borderColor: VIOLET,
                borderStyle: "dashed",
                background: "var(--d-accent)",
              }
        }
      >
        {busy === "selfie" ? (
          <Loader2 className="size-10 animate-spin" style={{ color: VIOLET }} />
        ) : selfie?.view_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={selfie.view_url}
            alt={tr("Votre visage", "وجهك")}
            className="h-full w-full object-cover"
          />
        ) : (
          <Camera className="size-12" style={{ color: VIOLET }} />
        )}
      </div>
      {selfie && <StatusChip info={selfie} center />}
      {/* ANTI-FRAUDE : selfie VALIDÉ = verrouillé (ni reprise ni suppression
          côté chauffeur) — seule l'équipe Coligo peut demander une reprise. */}
      {selfie?.status !== "approved" && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="drive-sora h-[46px] flex-1 rounded-[17px] bg-[var(--d-soft)] text-sm font-bold"
          >
            {selfie
              ? tr("Reprendre la photo", "إعادة التقاط الصورة")
              : tr("Ouvrir la caméra · capturer", "فتح الكاميرا · التقاط")}
          </button>
          {selfie && (
            <button
              type="button"
              onClick={() => void remove("selfie")}
              aria-label={tr("Supprimer le selfie", "حذف السيلفي")}
              className="grid size-[46px] shrink-0 place-items-center rounded-[17px] border-[1.5px] border-[var(--d-line)]"
              style={{ color: RED }}
            >
              <Trash2 className="size-4.5" />
            </button>
          )}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-[var(--d-muted)]">
        {isAr ? (
          <>
            وجه محايد، دون نظارات أو قبعة.{" "}
            <b>التقاط مباشر فقط — لا يُقبل أي استيراد ملف.</b>
          </>
        ) : (
          <>
            Visage neutre, sans lunettes ni casquette.{" "}
            <b>
              Prise en direct uniquement — aucun import de fichier n&apos;est
              accepté.
            </b>
          </>
        )}
      </p>
    </div>
  );

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-10">
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={tr("Retour", "رجوع")}
          className="grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
        >
          <ChevronLeft className="size-5 rtl:rotate-180" />
        </button>
        <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
          {tr("Mes documents", "وثائقي")}
        </h1>
      </div>
      {rejectedReason && (
        <p
          className="mb-3 rounded-[13px] px-3 py-2.5 text-xs leading-relaxed font-bold"
          style={{ background: "rgba(229,72,77,.1)", color: RED }}
        >
          {isAr
            ? `ملف مرفوض: ${rejectedReason} — صحّح ثم أعد إرسال ملفك.`
            : `Dossier refusé : ${rejectedReason} — corrigez puis renvoyez votre dossier.`}
        </p>
      )}
      {allValidated ? (
        /* Dossier complet et validé : AUCUNE liste, aucun bouton d'édition —
           un seul message. Toute modification passe par l'équipe Coligo
           (rejet avec motif), qui ré-affiche la liste. */
        <div
          className="mt-3 rounded-[18px] border-[1.5px] px-4 py-6 text-center"
          style={{ borderColor: GO, background: "rgba(22,179,100,.08)" }}
        >
          <span
            className="mx-auto mb-2.5 grid size-12 place-items-center rounded-full"
            style={{ background: "rgba(22,179,100,.14)", color: GO }}
          >
            <FileText className="size-5" />
          </span>
          <p className="drive-sora text-[15.5px] font-extrabold">
            {tr(
              "Tous vos documents sont validés et à jour",
              "جميع وثائقك مصادَق عليها ومحدَّثة"
            )}
          </p>
          <p className="mt-1 text-[12px] text-[var(--d-muted)]">
            {tr(
              "Rien à faire de votre côté. Si une pièce doit être mise à jour, l'équipe Coligo vous enverra une demande de modification.",
              "لا شيء مطلوب منك. إذا لزم تحديث وثيقة، سيرسل لك فريق Coligo طلب تعديل."
            )}
          </p>
        </div>
      ) : (
        <>
          {/* ÉTAPE IDENTITÉ — système partagé. Si la vérification automatique
              n'est pas publiée pour les chauffeurs, le composant rend
              directement le selfie en direct : l'écran d'avant, à l'identique. */}
          <IdvVerifyStep
            idv={idv}
            method={method}
            onMethod={setMethod}
            saveMethod={setChauffeurKycMethod}
          >
            {selfieSection}
          </IdvVerifyStep>

          <p className="mt-3 mb-1.5 text-[13px] font-bold">
            {tr("Documents du véhicule", "وثائق المركبة")}
          </p>
          <p className="mb-2.5 text-[12px] text-[var(--d-muted)]">
            {tr(
              "Photos nettes et lisibles, documents en cours de validité.",
              "صور واضحة ومقروءة، ووثائق سارية الصلاحية."
            )}
          </p>

          {DOCS.map((d) => (
            <DocRow
              key={d.kind}
              doc={d}
              isAr={isAr}
              info={docs[d.kind] ?? null}
              busy={busy === d.kind}
              onFile={(f) => void upload(d.kind, f)}
              onDelete={() => void remove(d.kind)}
            />
          ))}

          {error && (
            <p
              className="mt-3 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
              style={{ background: "rgba(229,72,77,.1)", color: RED }}
            >
              {error}
            </p>
          )}
          {/* UN SEUL bouton : « Vérifier mon identité » (ou « Actualiser »
              pendant l'examen) tant que la vérification bloque, « Envoyer mon
              dossier » seulement une fois l'identité prouvée. */}
          <div className="mt-4">
            <IdvPrimaryButton idv={idv} method={method} busy={submitting}>
              <PrimaryBtn onClick={() => void submit()} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : null}
                {tr("Envoyer mon dossier", "إرسال ملفي")}
              </PrimaryBtn>
            </IdvPrimaryButton>
          </div>
        </>
      )}

      {cameraOpen && (
        <SelfieCamera
          onClose={() => setCameraOpen(false)}
          onCapture={async (file) => {
            setCameraOpen(false);
            await upload("selfie", file);
          }}
        />
      )}

      {/* Confirmation designée (remplace window.confirm) */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[140] flex flex-col justify-end bg-black/45"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="drive-jakarta rounded-t-[24px] bg-[var(--d-surface)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <b className="drive-sora block text-[16px] font-extrabold">
              {tr("Supprimer cette photo ?", "حذف هذه الصورة؟")}
            </b>
            <p className="mt-1 mb-3 text-[13px] text-[var(--d-muted)]">
              {tr(
                "Vous devrez la reprendre pour valider votre dossier.",
                "سيتعيّن عليك إعادة التقاطها لإتمام ملفك."
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="drive-sora h-12 flex-1 rounded-[14px] border border-[var(--d-line)] text-sm font-bold"
              >
                {tr("Annuler", "إلغاء")}
              </button>
              <button
                type="button"
                onClick={() => void doRemove(confirmDelete)}
                className="drive-sora h-12 flex-1 rounded-[14px] text-sm font-bold text-white"
                style={{ background: RED }}
              >
                {tr("Supprimer", "حذف")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({
  info,
  center = false,
}: {
  info: ChauffeurDocInfo;
  center?: boolean;
}) {
  const isAr = useLocale() === "ar";
  const style =
    info.status === "approved"
      ? { background: "rgba(22,179,100,.12)", color: GO }
      : info.status === "rejected"
        ? { background: "rgba(229,72,77,.12)", color: RED }
        : { background: "var(--d-accent)", color: VIOLET };
  const label =
    info.status === "approved"
      ? isAr
        ? "✓ مقبول"
        : "✓ Validé"
      : info.status === "rejected"
        ? `${isAr ? "مرفوض" : "Refusé"}${info.review_note ? ` · ${info.review_note}` : ""}`
        : isAr
          ? "قيد التحقّق"
          : "En vérification";
  return (
    <span
      className={`${center ? "mx-auto" : ""}inline-block max-w-full truncate rounded-full px-2.5 py-1 text-[10px] font-extrabold`}
      style={style}
    >
      {label}
    </span>
  );
}

function DocRow({
  doc,
  isAr,
  info,
  busy,
  onFile,
  onDelete,
}: {
  doc: {
    kind: DocKind;
    title: string;
    titleAr: string;
    sub: string;
    subAr: string;
    required: boolean;
  };
  isAr: boolean;
  info: ChauffeurDocInfo | null;
  busy: boolean;
  onFile: (f: File) => void;
  onDelete: () => void;
}) {
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      className="mb-2 rounded-[16px] border-[1.5px] p-3"
      style={
        info?.status === "approved"
          ? { borderColor: GO, background: "rgba(22,179,100,.08)" }
          : info?.status === "rejected"
            ? { borderColor: RED, background: "rgba(229,72,77,.06)" }
            : { borderColor: "var(--d-line)" }
      }
    >
      <div className="flex items-center gap-3">
        {/* Aperçu de la photo envoyée (sinon icône) */}
        <button
          type="button"
          onClick={() =>
            info?.view_url
              ? window.open(info.view_url, "_blank")
              : inputRef.current?.click()
          }
          aria-label={
            info
              ? tr("Voir la photo", "عرض الصورة")
              : tr("Ajouter la photo", "إضافة الصورة")
          }
          className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-[var(--d-soft)]"
        >
          {busy ? (
            <Loader2
              className="size-4.5 animate-spin"
              style={{ color: VIOLET }}
            />
          ) : info?.view_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={info.view_url}
              alt={isAr ? doc.titleAr : doc.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <FileText className="size-4.5" />
          )}
        </button>
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px]">
            {isAr ? doc.titleAr : doc.title}
          </b>
          <small className="text-[11px] text-[var(--d-muted)]">
            {isAr ? doc.subAr : doc.sub}
          </small>
        </span>
        {info ? (
          <StatusChip info={info} />
        ) : (
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold"
            style={
              doc.required
                ? { background: "rgba(229,72,77,.12)", color: RED }
                : { background: "var(--d-soft)", color: "var(--d-muted)" }
            }
          >
            {doc.required
              ? tr("Obligatoire", "إلزامي")
              : tr("Optionnel", "اختياري")}
          </span>
        )}
      </div>

      {/* Actions : ajouter / voir / remplacer / supprimer.
          ANTI-FRAUDE : une pièce VALIDÉE est verrouillée — consultation
          seule, ni remplacement ni suppression. Elle ne redevient modifiable
          que si l'équipe Coligo la rejette (demande de modification). */}
      <div className="mt-2 flex gap-1.5">
        {!info ? (
          <ActionBtn
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            primary
          >
            <Camera className="size-3.5" />{" "}
            {tr("Ajouter la photo", "إضافة الصورة")}
          </ActionBtn>
        ) : info.status === "approved" ? (
          <ActionBtn
            onClick={() =>
              info.view_url && window.open(info.view_url, "_blank")
            }
            disabled={busy || !info.view_url}
          >
            <Eye className="size-3.5" /> {tr("Voir", "عرض")}
          </ActionBtn>
        ) : (
          <>
            <ActionBtn
              onClick={() =>
                info.view_url && window.open(info.view_url, "_blank")
              }
              disabled={busy || !info.view_url}
            >
              <Eye className="size-3.5" /> {tr("Voir", "عرض")}
            </ActionBtn>
            <ActionBtn
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <RefreshCw className="size-3.5" /> {tr("Remplacer", "استبدال")}
            </ActionBtn>
            <ActionBtn onClick={onDelete} disabled={busy} danger>
              <Trash2 className="size-3.5" /> {tr("Supprimer", "حذف")}
            </ActionBtn>
          </>
        )}
      </div>

      {/* Pièces : photo via caméra arrière (capture) ou galerie */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  primary = false,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-[11px] border-[1.5px] px-2 py-2 text-[11px] font-bold disabled:opacity-50"
      style={
        primary
          ? {
              borderColor: VIOLET,
              background: "var(--d-accent)",
              color: VIOLET,
            }
          : danger
            ? { borderColor: "var(--d-line)", color: RED }
            : { borderColor: "var(--d-line)", color: "var(--d-muted)" }
      }
    >
      {children}
    </button>
  );
}

/**
 * Capture selfie via getUserMedia (caméra FRONTALE) — l'import de fichier est
 * volontairement impossible : on photographie le flux vidéo dans un canvas.
 */
function SelfieCamera({
  onClose,
  onCapture,
}: {
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isAr = useLocale() === "ar";
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (stop) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setErr(
          isAr
            ? "تعذّر الوصول إلى الكاميرا — اسمح بالوصول لالتقاط السيلفي."
            : "Caméra inaccessible — autorisez l'accès à la caméra pour le selfie."
        );
      }
    })();
    return () => {
      stop = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = 720;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(
      video,
      (video.videoWidth - size) / 2,
      (video.videoHeight - size) / 2,
      size,
      size,
      0,
      0,
      720,
      720
    );
    canvas.toBlob(
      (blob) => {
        if (blob)
          onCapture(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.85
    );
  };

  return (
    <div className="fixed inset-0 z-[140] flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        {/* playsInline requis sur iOS / WebView Capacitor */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="size-64 rounded-full border-4 border-dashed border-white/70" />
        </div>
        {err && (
          <p
            className="absolute right-4 bottom-28 left-4 rounded-[12px] bg-[var(--d-surface)] px-3 py-2 text-center text-xs font-bold"
            style={{ color: RED }}
          >
            {err}
          </p>
        )}
      </div>
      <div className="flex items-center justify-center gap-8 bg-black px-6 py-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-bold text-white/80"
        >
          {isAr ? "إلغاء" : "Annuler"}
        </button>
        <button
          type="button"
          onClick={capture}
          aria-label={isAr ? "التقاط" : "Capturer"}
          className="grid size-[68px] place-items-center rounded-full border-4 border-white"
        >
          <span className="size-[52px] rounded-full bg-white" />
        </button>
        <span className="w-12" />
      </div>
    </div>
  );
}
