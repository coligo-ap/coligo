"use client";

// =============================================================================
// IDV — CONTRÔLEUR du parcours de capture du document (étape 4) :
// statut → intro → capture (recto puis verso) → revue → envoi → statut.
// Le serveur revalide tout (magic bytes, qualité) : ici on orchestre l'UX.
// =============================================================================

import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw, Send } from "lucide-react";
import { IdvIntro } from "./idv-intro";
import { IdvDocCapture } from "./idv-doc-capture";
import { IdvStatusPanel } from "./idv-status-panel";
import {
  submitIdvDocument,
  type IdvSubmitState,
} from "@/app/(driver)/driver/identite/actions";
import type {
  IdvDocumentType,
  IdvModePublic,
  IdvStatus,
} from "@/lib/idv/types";
import type { IdvVerificationView } from "@/lib/idv/user-data";

const initialState: IdvSubmitState = {};

type Step = "status" | "intro" | "capture" | "review";
type Side = "front" | "back";

/** Ratio du gabarit : passeport (page photo TD3) ≈ 1.42, carte ID-1 ≈ 1.586. */
function docRatio(doc: IdvDocumentType | undefined): number {
  return doc?.mrz_format === "td3" ? 125 / 88 : 85.6 / 54;
}

function sideLabel(doc: IdvDocumentType | undefined, side: Side): string {
  if (doc?.sides === 1) return "Page photo";
  return side === "front" ? "Recto" : "Verso";
}

export function IdvFlow({
  docTypes,
  modes,
  canChooseMode,
  defaultMode,
  verification,
}: {
  docTypes: IdvDocumentType[];
  modes: IdvModePublic[];
  canChooseMode: boolean;
  defaultMode: string;
  verification: IdvVerificationView | null;
}) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(
    submitIdvDocument,
    initialState
  );

  const resumable =
    !verification ||
    verification.status === "draft" ||
    verification.status === "resubmit_document";
  const [step, setStep] = useState<Step>(resumable ? "intro" : "status");
  const [side, setSide] = useState<Side>("front");
  const [docKey, setDocKey] = useState(
    verification?.document_type ?? docTypes[0]?.key ?? ""
  );
  const [modeKey, setModeKey] = useState(verification?.mode ?? defaultMode);
  const [captures, setCaptures] = useState<{ front?: Blob; back?: Blob }>({});
  /** Statut renvoyé par l'action (plus frais que la prop RSC). */
  const [statusOverride, setStatusOverride] = useState<IdvStatus | null>(null);
  /** L'erreur serveur ne doit plus s'afficher sur des photos REPRISES. */
  const [errorDismissed, setErrorDismissed] = useState(false);

  const doc = docTypes.find((d) => d.key === docKey);

  // Aperçus : URLs d'objets créées/révoquées proprement.
  const frontUrl = useMemo(
    () => (captures.front ? URL.createObjectURL(captures.front) : null),
    [captures.front]
  );
  const backUrl = useMemo(
    () => (captures.back ? URL.createObjectURL(captures.back) : null),
    [captures.back]
  );
  useEffect(
    () => () => {
      if (frontUrl) URL.revokeObjectURL(frontUrl);
      if (backUrl) URL.revokeObjectURL(backUrl);
    },
    [frontUrl, backUrl]
  );

  // Résultat de l'envoi : succès (ou passage en revue humaine) → écran statut.
  useEffect(() => {
    if (state.ok && state.status) {
      setStatusOverride(state.status);
      setStep("status");
      router.refresh();
    }
  }, [state, router]);

  const submit = () => {
    if (!doc || !captures.front) return;
    const fd = new FormData();
    fd.set("document_type", doc.key);
    fd.set("mode", modeKey);
    fd.set(
      "doc_front",
      new File([captures.front], "front.jpg", { type: "image/jpeg" })
    );
    if (doc.sides === 2 && captures.back) {
      fd.set(
        "doc_back",
        new File([captures.back], "back.jpg", { type: "image/jpeg" })
      );
    }
    setErrorDismissed(false);
    startTransition(() => dispatch(fd));
  };

  // ── Écrans ────────────────────────────────────────────────────────────────
  if (step === "status") {
    return (
      <IdvStatusPanel
        status={statusOverride ?? verification?.status ?? "draft"}
        onRetryDocument={
          (statusOverride ?? verification?.status) === "resubmit_document"
            ? () => {
                setCaptures({});
                setSide("front");
                setStep("intro");
              }
            : undefined
        }
      />
    );
  }

  if (step === "intro") {
    return (
      <IdvIntro
        docTypes={docTypes}
        modes={modes}
        canChooseMode={canChooseMode}
        defaultMode={defaultMode}
        onStart={(d, m) => {
          setDocKey(d);
          setModeKey(m);
          setCaptures({});
          setSide("front");
          setStep("capture");
        }}
      />
    );
  }

  if (step === "capture") {
    return (
      <IdvDocCapture
        title={doc?.label_fr ?? "Document"}
        sideLabel={sideLabel(doc, side)}
        ratio={docRatio(doc)}
        onCapture={(blob) => {
          setCaptures((c) => ({ ...c, [side]: blob }));
          setStep("review");
        }}
        onClose={() => setStep(captures.front ? "review" : "intro")}
      />
    );
  }

  // step === "review"
  const needsBack = doc?.sides === 2 && !captures.back;
  return (
    <div className="space-y-4 pb-6">
      <p className="text-sm font-semibold">
        {needsBack ? "Recto capturé — au tour du verso" : "Vérifiez vos photos"}
      </p>

      <div className="space-y-3">
        {frontUrl && (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu blob local */}
            <img
              src={frontUrl}
              alt="Aperçu du recto"
              className="w-full rounded-[14px] border"
              style={{ borderColor: "var(--d-line)" }}
            />
            <figcaption
              className="text-[11px]"
              style={{ color: "var(--d-muted)" }}
            >
              {sideLabel(doc, "front")}
            </figcaption>
          </figure>
        )}
        {backUrl && (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu blob local */}
            <img
              src={backUrl}
              alt="Aperçu du verso"
              className="w-full rounded-[14px] border"
              style={{ borderColor: "var(--d-line)" }}
            />
            <figcaption
              className="text-[11px]"
              style={{ color: "var(--d-muted)" }}
            >
              Verso
            </figcaption>
          </figure>
        )}
      </div>

      {state.error && !errorDismissed && (
        <p
          className="rounded-[12px] px-3 py-2.5 text-sm"
          style={{
            background: "rgba(239,68,68,.12)",
            color: "var(--d-coral, #ef4444)",
          }}
        >
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (state.error && !errorDismissed) {
              // Refus qualité serveur : on reprend TOUT (l'erreur peut
              // concerner n'importe quelle face) et on masque l'erreur.
              setErrorDismissed(true);
              setCaptures({});
              setSide("front");
              setStep("capture");
              return;
            }
            // Sinon : reprendre la dernière face capturée.
            const retake: Side = needsBack || !captures.back ? side : "back";
            setCaptures((c) => ({ ...c, [retake]: undefined }));
            setSide(retake);
            setStep("capture");
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full border py-3 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "var(--d-line)", color: "var(--d-ink)" }}
        >
          <RefreshCcw className="size-4" />
          Reprendre
        </button>
        {needsBack ? (
          <button
            type="button"
            onClick={() => {
              setSide("back");
              setStep("capture");
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-sm font-semibold text-white"
            style={{ background: "var(--d-accent)" }}
          >
            Scanner le verso
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={pending || !captures.front}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--d-accent)" }}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Analyse…
              </>
            ) : (
              <>
                <Send className="size-4" />
                Envoyer
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
