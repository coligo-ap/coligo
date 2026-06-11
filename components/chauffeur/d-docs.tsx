"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  submitChauffeurDossier,
  uploadChauffeurDoc,
  type ChauffeurDocInfo,
  type DocKind,
} from "@/app/(chauffeur)/actions";

const DOCS: {
  kind: DocKind;
  title: string;
  sub: string;
  required: boolean;
}[] = [
  {
    kind: "permis_recto",
    title: "Permis de conduire (recto)",
    sub: "Photo nette du recto",
    required: true,
  },
  {
    kind: "permis_verso",
    title: "Permis de conduire (verso)",
    sub: "Photo nette du verso",
    required: true,
  },
  {
    kind: "carte_grise",
    title: "Carte grise",
    sub: "Du véhicule déclaré",
    required: true,
  },
  {
    kind: "plaque",
    title: "Immatriculation",
    sub: "Photo de la plaque du véhicule",
    required: true,
  },
  {
    kind: "assurance",
    title: "Assurance",
    sub: "Si disponible",
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
 * Documents + selfie EN DIRECT (maquette s-ddocs). Le selfie passe par un
 * flux caméra (getUserMedia, caméra frontale) — AUCUN import de fichier
 * accepté pour le selfie. Chaque pièce envoyée s'affiche en APERÇU avec
 * Voir / Remplacer / Supprimer.
 */
export function DDocs({ rejectedReason }: { rejectedReason?: string | null }) {
  const router = useRouter();
  const [docs, setDocs] = useState<Record<string, ChauffeurDocInfo>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

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
    else setError(res.error ?? "Envoi impossible");
    setBusy(null);
  };

  const remove = async (kind: DocKind) => {
    if (!window.confirm("Supprimer cette photo ?")) return;
    setBusy(kind);
    setError(null);
    const res = await deleteChauffeurDoc(kind);
    if (res.ok) await refresh();
    else setError(res.error ?? "Suppression impossible");
    setBusy(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const res = await submitChauffeurDossier();
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? "Dossier incomplet");
      return;
    }
    router.replace("/chauffeur");
  };

  const selfie = docs.selfie;

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-10">
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/chauffeur/login")}
          className="grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
          Mes documents
        </h1>
      </div>
      {rejectedReason && (
        <p
          className="mb-3 rounded-[13px] px-3 py-2.5 text-xs leading-relaxed font-bold"
          style={{ background: "rgba(229,72,77,.1)", color: RED }}
        >
          Dossier refusé : {rejectedReason} — corrigez puis renvoyez votre
          dossier.
        </p>
      )}
      <p className="mb-3 text-[13px] text-[var(--d-muted)]">
        Photos nettes et lisibles. Votre dossier sera vérifié par l&apos;équipe
        Coligo.
      </p>

      {DOCS.map((d) => (
        <DocRow
          key={d.kind}
          doc={d}
          info={docs[d.kind] ?? null}
          busy={busy === d.kind}
          onFile={(f) => void upload(d.kind, f)}
          onDelete={() => void remove(d.kind)}
        />
      ))}

      {/* Selfie en direct (caméra uniquement) — la photo du visage est
          OBLIGATOIRE et affichée une fois capturée. */}
      <div className="mt-4 text-center">
        <p className="text-[13.5px] font-bold">
          Photo de votre visage · en direct{" "}
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
                  background: "#EEEEFD",
                }
          }
        >
          {busy === "selfie" ? (
            <Loader2
              className="size-10 animate-spin"
              style={{ color: VIOLET }}
            />
          ) : selfie?.view_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selfie.view_url}
              alt="Votre visage"
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera className="size-12" style={{ color: VIOLET }} />
          )}
        </div>
        {selfie && <StatusChip info={selfie} center />}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="drive-sora h-[46px] flex-1 rounded-[17px] bg-[var(--d-soft)] text-sm font-bold"
          >
            {selfie ? "Reprendre la photo" : "Ouvrir la caméra · capturer"}
          </button>
          {selfie && (
            <button
              type="button"
              onClick={() => void remove("selfie")}
              aria-label="Supprimer le selfie"
              className="grid size-[46px] shrink-0 place-items-center rounded-[17px] border-[1.5px] border-[var(--d-line)]"
              style={{ color: RED }}
            >
              <Trash2 className="size-4.5" />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--d-muted)]">
          Visage neutre, sans lunettes ni casquette.{" "}
          <b>
            Prise en direct uniquement — aucun import de fichier n&apos;est
            accepté.
          </b>
        </p>
      </div>

      {error && (
        <p
          className="mt-3 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
          style={{ background: "rgba(229,72,77,.1)", color: RED }}
        >
          {error}
        </p>
      )}
      <PrimaryBtn
        onClick={() => void submit()}
        disabled={submitting}
        className="!mt-4"
      >
        {submitting ? <Loader2 className="size-5 animate-spin" /> : null}
        Envoyer mon dossier
      </PrimaryBtn>

      {cameraOpen && (
        <SelfieCamera
          onClose={() => setCameraOpen(false)}
          onCapture={async (file) => {
            setCameraOpen(false);
            await upload("selfie", file);
          }}
        />
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
  const style =
    info.status === "approved"
      ? { background: "rgba(22,179,100,.12)", color: GO }
      : info.status === "rejected"
        ? { background: "rgba(229,72,77,.12)", color: RED }
        : { background: "#EEEEFD", color: VIOLET };
  const label =
    info.status === "approved"
      ? "✓ Validé"
      : info.status === "rejected"
        ? `Refusé${info.review_note ? ` · ${info.review_note}` : ""}`
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
  info,
  busy,
  onFile,
  onDelete,
}: {
  doc: { kind: DocKind; title: string; sub: string; required: boolean };
  info: ChauffeurDocInfo | null;
  busy: boolean;
  onFile: (f: File) => void;
  onDelete: () => void;
}) {
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
          aria-label={info ? "Voir la photo" : "Ajouter la photo"}
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
              alt={doc.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <FileText className="size-4.5" />
          )}
        </button>
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px]">{doc.title}</b>
          <small className="text-[11px] text-[var(--d-muted)]">{doc.sub}</small>
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
            {doc.required ? "Obligatoire" : "Optionnel"}
          </span>
        )}
      </div>

      {/* Actions : ajouter / voir / remplacer / supprimer */}
      <div className="mt-2 flex gap-1.5">
        {!info ? (
          <ActionBtn
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            primary
          >
            <Camera className="size-3.5" /> Ajouter la photo
          </ActionBtn>
        ) : (
          <>
            <ActionBtn
              onClick={() =>
                info.view_url && window.open(info.view_url, "_blank")
              }
              disabled={busy || !info.view_url}
            >
              <Eye className="size-3.5" /> Voir
            </ActionBtn>
            <ActionBtn
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <RefreshCw className="size-3.5" /> Remplacer
            </ActionBtn>
            <ActionBtn onClick={onDelete} disabled={busy} danger>
              <Trash2 className="size-3.5" /> Supprimer
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
          ? { borderColor: VIOLET, background: "#EEEEFD", color: VIOLET }
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
          "Caméra inaccessible — autorisez l'accès à la caméra pour le selfie."
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
      <div className="flex items-center justify-center gap-8 bg-black px-6 py-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-bold text-white/80"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={capture}
          aria-label="Capturer"
          className="grid size-[68px] place-items-center rounded-full border-4 border-white"
        >
          <span className="size-[52px] rounded-full bg-white" />
        </button>
        <span className="w-12" />
      </div>
    </div>
  );
}
