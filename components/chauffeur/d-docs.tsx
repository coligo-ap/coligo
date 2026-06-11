"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronLeft, FileText, Loader2 } from "lucide-react";
import {
  VIOLET,
  GO,
  RED,
  PrimaryBtn,
} from "@/components/customer/drive/drive-modals";
import {
  getChauffeurDocs,
  submitChauffeurDossier,
  uploadChauffeurDoc,
  type DocKind,
} from "@/app/(chauffeur)/actions";

const DOCS: {
  kind: DocKind;
  title: string;
  sub: string;
  required: boolean;
  camera?: boolean;
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
 * Documents + selfie EN DIRECT (maquette s-ddocs). Le selfie passe par un
 * flux caméra (getUserMedia, caméra frontale) — AUCUN import de fichier
 * accepté pour le selfie. Les pièces utilisent capture="environment".
 */
export function DDocs() {
  const router = useRouter();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    void getChauffeurDocs().then(setDone);
  }, []);

  const upload = async (kind: DocKind, file: File) => {
    setBusy(kind);
    setError(null);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    const res = await uploadChauffeurDoc(fd);
    if (res.ok) setDone((d) => ({ ...d, [kind]: true }));
    else setError(res.error ?? "Envoi impossible");
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

  return (
    <div className="drive-jakarta min-h-screen bg-white px-5 pt-4 pb-10">
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/chauffeur/login")}
          className="grid size-[42px] place-items-center rounded-[14px] border border-[#EEF0F4] bg-white shadow"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
          Mes documents
        </h1>
      </div>
      <p className="mb-3 text-[13px] text-[#6B7280]">
        Photos nettes et lisibles. Votre dossier sera vérifié par l&apos;équipe
        Coligo.
      </p>

      {DOCS.map((d) => (
        <DocRow
          key={d.kind}
          doc={d}
          done={!!done[d.kind]}
          busy={busy === d.kind}
          onFile={(f) => void upload(d.kind, f)}
        />
      ))}

      {/* Selfie en direct (caméra uniquement) */}
      <div className="mt-4 text-center">
        <p className="text-[13.5px] font-bold">
          Photo de votre visage · en direct
        </p>
        <div
          className="mx-auto my-2.5 grid size-32 place-items-center rounded-full border-[3px]"
          style={
            done.selfie
              ? { borderColor: GO, background: "rgba(22,179,100,.12)" }
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
          ) : done.selfie ? (
            <Check className="size-12" style={{ color: GO }} />
          ) : (
            <Camera className="size-12" style={{ color: VIOLET }} />
          )}
        </div>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="drive-sora h-[46px] w-full rounded-[17px] bg-[#F4F5F9] text-sm font-bold"
        >
          {done.selfie ? "Reprendre la photo" : "Ouvrir la caméra · capturer"}
        </button>
        <p className="mt-1.5 text-[11px] text-[#6B7280]">
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

function DocRow({
  doc,
  done,
  busy,
  onFile,
}: {
  doc: { kind: DocKind; title: string; sub: string; required: boolean };
  done: boolean;
  busy: boolean;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="mb-2 flex w-full items-center gap-3 rounded-[16px] border-[1.5px] p-3 text-left"
      style={
        done
          ? { borderColor: GO, background: "rgba(22,179,100,.12)" }
          : { borderColor: "#EEF0F4" }
      }
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[#F4F5F9]">
        {busy ? (
          <Loader2
            className="size-4.5 animate-spin"
            style={{ color: VIOLET }}
          />
        ) : (
          <FileText className="size-4.5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[13.5px]">{doc.title}</b>
        <small className="text-[11px] text-[#6B7280]">{doc.sub}</small>
      </span>
      <span
        className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold"
        style={
          done
            ? { background: "rgba(22,179,100,.12)", color: GO }
            : doc.required
              ? { background: "rgba(229,72,77,.12)", color: RED }
              : { background: "#F4F5F9", color: "#6B7280" }
        }
      >
        {done ? "✓ Ajouté" : doc.required ? "Obligatoire" : "Optionnel"}
      </span>
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
            className="absolute right-4 bottom-28 left-4 rounded-[12px] bg-white px-3 py-2 text-center text-xs font-bold"
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
