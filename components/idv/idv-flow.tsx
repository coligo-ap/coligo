"use client";

// =============================================================================
// IDV — CONTRÔLEUR du parcours : statut → intro → capture document (recto puis
// verso) → revue → envoi → « Document validé » → selfie à défis → statut.
// Le serveur revalide et JUGE tout (magic bytes, qualité, MRZ, liveness) :
// ici on orchestre l'UX. Les défis liveness sont tirés et signés par le
// serveur (startIdvSelfie) — le client ne les invente jamais.
// =============================================================================

import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Loader2, RefreshCcw, Send } from "lucide-react";
import { IdvIntro } from "./idv-intro";
import { IdvDocCapture } from "./idv-doc-capture";
import { IdvSelfieCapture } from "./idv-selfie-capture";
import { IdvStatusPanel } from "./idv-status-panel";
import { IdvStepper } from "./idv-stepper";
import { IdvScanOverlay } from "./idv-scan-overlay";
import { compressCapture, DOC_TARGET, SELFIE_TARGET } from "@/lib/idv/compress";
import { IdvScope } from "./idv-theme";
import { IdvActionIntro } from "./idv-action-intro";
import { IllusSelfie } from "./idv-illustrations";
import {
  startIdvSelfie,
  submitIdvDocument,
  submitIdvSelfie,
  type IdvSubmitState,
} from "@/app/idv/actions";
import type { IdvChallenge } from "@/lib/idv/liveness";
import type {
  IdvDocumentType,
  IdvModePublic,
  IdvStatus,
} from "@/lib/idv/types";
import type { IdvVerificationView } from "@/lib/idv/user-data";

const initialState: IdvSubmitState = {};

type Step =
  | "status"
  | "intro"
  | "capture"
  | "review"
  /** Annonce du selfie, JUSTE avant de l'ouvrir (jamais 3 explications d'un coup). */
  | "selfie-intro"
  | "selfie";
type Side = "front" | "back";

type SelfieSession = {
  challenges: IdvChallenge[];
  token: string;
  expiresAt: number;
};

/** Ratio du gabarit : passeport (page photo TD3) ≈ 1.42, carte ID-1 ≈ 1.586. */
function docRatio(doc: IdvDocumentType | undefined): number {
  return doc?.mrz_format === "td3" ? 125 / 88 : 85.6 / 54;
}

function sideLabel(
  doc: IdvDocumentType | undefined,
  side: Side,
  isAr: boolean
): string {
  if (doc?.sides === 1) return isAr ? "صفحة الصورة" : "Page photo";
  if (side === "front") return isAr ? "الوجه الأمامي" : "Recto";
  return isAr ? "الوجه الخلفي" : "Verso";
}

/**
 * Reprise sur PANNE DE TRANSPORT. Un `fetch` qui rejette (réseau coupé, cellule
 * changée, écran verrouillé) n'a jamais atteint le serveur : on peut réessayer
 * sans risque de compter deux tentatives. Une erreur RENVOYÉE par le serveur,
 * elle, n'est pas rejouée — elle est vraie.
 */
async function withNetworkRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof TypeError)) throw e; // erreur applicative : on la garde
    await new Promise((r) => setTimeout(r, 1200));
    return call();
  }
}

export function IdvFlow({
  profile,
  docTypes,
  modes,
  canChooseMode,
  defaultMode,
  verification,
}: {
  /** Espace d'où part le parcours — REVALIDÉ côté serveur (resolveProfile). */
  profile: "driver" | "chauffeur" | "merchant";
  docTypes: IdvDocumentType[];
  modes: IdvModePublic[];
  canChooseMode: boolean;
  defaultMode: string;
  verification: IdvVerificationView | null;
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  // Une coupure réseau au mauvais moment (changement de cellule, écran
  // verrouillé) ne doit pas coûter un dossier : on réessaie UNE fois, et
  // uniquement sur une panne de transport (la requête n'est jamais partie).
  // Jamais plus : une deuxième tentative « en aveugle » risquerait de compter
  // deux essais côté serveur.
  const [state, dispatch, pending] = useActionState(
    (prev: IdvSubmitState, fd: FormData) =>
      withNetworkRetry(() => submitIdvDocument(prev, fd)),
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
  /** Écran d'ANALYSE (contrôles animés) : « document » ou « selfie ». */
  const [analyzing, setAnalyzing] = useState<"document" | "selfie" | null>(
    null
  );

  // ── Selfie (étape 6) : session de défis émise par le serveur ──────────────
  const [selfieState, selfieDispatch, selfiePending] = useActionState(
    (prev: IdvSubmitState, fd: FormData) =>
      withNetworkRetry(() => submitIdvSelfie(prev, fd)),
    initialState
  );
  const [session, setSession] = useState<SelfieSession | null>(null);
  const [selfieStarting, setSelfieStarting] = useState(false);
  const [selfieError, setSelfieError] = useState<string | null>(null);

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

  // Résultat du selfie : statut mis à jour ; un échec REPRENABLE laisse le
  // dossier en place (le bouton « Refaire le selfie » reste offert).
  useEffect(() => {
    if (selfieState.status) setStatusOverride(selfieState.status);
    if (selfieState.ok) router.refresh();
  }, [selfieState, router]);

  const submit = () => {
    if (!doc || !captures.front) return;
    setErrorDismissed(false);
    setAnalyzing("document");
    // Les captures sont ramenées sous un budget d'octets AVANT l'envoi : sur un
    // réseau lent, un envoi de 3 Mo n'est pas « lent », il échoue.
    void (async () => {
      const front = await compressCapture(captures.front!, DOC_TARGET);
      const back =
        doc.sides === 2 && captures.back
          ? await compressCapture(captures.back, DOC_TARGET)
          : null;
      const fd = new FormData();
      fd.set("profile", profile);
      fd.set("document_type", doc.key);
      fd.set("mode", modeKey);
      fd.set(
        "doc_front",
        new File([front], "front.jpg", { type: "image/jpeg" })
      );
      if (back) {
        fd.set(
          "doc_back",
          new File([back], "back.jpg", { type: "image/jpeg" })
        );
      }
      startTransition(() => dispatch(fd));
    })();
  };

  // ── Selfie : le serveur tire les défis et signe la session ────────────────
  const beginSelfie = async () => {
    setSelfieStarting(true);
    setSelfieError(null);
    const res = await startIdvSelfie(profile);
    setSelfieStarting(false);
    if ("error" in res) {
      setSelfieError(res.error);
      return;
    }
    setSession(res);
    setStep("selfie");
  };

  const sendSelfie = (frames: Blob[], s: SelfieSession) => {
    setStep("status");
    setSession(null);
    setAnalyzing("selfie");
    void (async () => {
      const light = await Promise.all(
        frames.map((f) => compressCapture(f, SELFIE_TARGET))
      );
      const fd = new FormData();
      fd.set("profile", profile);
      fd.set("challenges", s.challenges.join(","));
      fd.set("token", s.token);
      fd.set("expires_at", String(s.expiresAt));
      light.forEach((blob, i) =>
        fd.set(
          `frame_${i}`,
          new File([blob], `frame-${i}.jpg`, { type: "image/jpeg" })
        )
      );
      startTransition(() => selfieDispatch(fd));
    })();
  };

  const currentStatus = statusOverride ?? verification?.status ?? "draft";
  const selfieReady =
    currentStatus === "doc_validated" || currentStatus === "resubmit_selfie";

  // Analyse en cours (ou verdicts à montrer) → écran d'analyse animé, posé
  // PAR-DESSUS l'écran courant. Les états affichés viennent du serveur.
  const analysisState = analyzing === "selfie" ? selfieState : state;
  const analysisSettled =
    Boolean(analysisState.ok) || Boolean(analysisState.error);

  // ── Écrans ────────────────────────────────────────────────────────────────
  const overlay = analyzing ? (
    <IdvScanOverlay
      phase={analyzing}
      previewUrl={analyzing === "document" ? frontUrl : null}
      results={analysisSettled ? (analysisState.checks ?? []) : null}
      errorMessage={analysisState.error ?? null}
      onDone={() => setAnalyzing(null)}
    />
  ) : null;

  if (step === "status") {
    return (
      <IdvScope>
        {overlay}
        <IdvStatusPanel
          status={currentStatus}
          onRetryDocument={
            currentStatus === "resubmit_document"
              ? () => {
                  setCaptures({});
                  setSide("front");
                  setStep("intro");
                }
              : undefined
          }
          onStartSelfie={
            selfieReady ? () => setStep("selfie-intro") : undefined
          }
          selfiePending={selfieStarting || selfiePending}
          selfieError={selfieError ?? selfieState.error ?? null}
        />
      </IdvScope>
    );
  }

  if (step === "selfie-intro") {
    return (
      <IdvScope>
        <IdvActionIntro
          illustration={<IllusSelfie size={112} />}
          eyebrow={tr("Étape 2 sur 3", "الخطوة 2 من 3")}
          title={tr("Selfie rapide", "سيلفي سريع")}
          hint={tr(
            "Quelques gestes simples pour prouver que c'est bien vous : regardez l'objectif, puis suivez les consignes à l'écran.",
            "بعض الحركات البسيطة لإثبات أنك أنت: انظر إلى العدسة ثم اتبع التعليمات على الشاشة."
          )}
          cta={tr("Commencer le selfie", "بدء السيلفي")}
          onStart={() => void beginSelfie()}
          pending={selfieStarting}
          error={selfieError}
        />
      </IdvScope>
    );
  }

  if (step === "selfie" && session) {
    return (
      <IdvSelfieCapture
        challenges={session.challenges}
        onDone={(frames) => sendSelfie(frames, session)}
        onClose={() => {
          setSession(null);
          setStep("status");
        }}
      />
    );
  }

  if (step === "intro") {
    return (
      <IdvScope className="space-y-4">
        <IdvStepper
          current="document"
          hint={tr("Choisissez votre document", "اختر وثيقتك")}
          progress={0}
        />
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
      </IdvScope>
    );
  }

  if (step === "capture") {
    return (
      <IdvDocCapture
        title={
          (isAr ? doc?.label_ar : null) ??
          doc?.label_fr ??
          tr("Document", "الوثيقة")
        }
        sideLabel={sideLabel(doc, side, isAr)}
        ratio={docRatio(doc)}
        stepHint={
          doc?.sides === 2
            ? side === "front"
              ? tr("Recto — 1 sur 2", "الوجه الأمامي — 1 من 2")
              : tr("Verso — 2 sur 2", "الوجه الخلفي — 2 من 2")
            : tr("Page photo", "صفحة الصورة")
        }
        stepProgress={doc?.sides === 2 ? (side === "front" ? 0.25 : 0.6) : 0.4}
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
    <IdvScope className="space-y-4 pb-6">
      {overlay}
      <IdvStepper
        current="document"
        hint={
          needsBack
            ? tr(
                "Recto capturé — passez au verso",
                "تم التقاط الوجه الأمامي — انتقل إلى الخلفي"
              )
            : tr("Vérifiez vos photos", "تحقّق من صورك")
        }
        progress={needsBack ? 0.5 : 0.85}
      />
      <p className="text-sm font-semibold">
        {needsBack
          ? tr(
              "Recto capturé — au tour du verso",
              "تم التقاط الوجه الأمامي — دور الوجه الخلفي"
            )
          : tr("Vérifiez vos photos", "تحقّق من صورك")}
      </p>

      <div className="space-y-3">
        {frontUrl && (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu blob local */}
            <img
              src={frontUrl}
              alt={tr("Aperçu du recto", "معاينة الوجه الأمامي")}
              className="w-full rounded-[14px] border"
              style={{ borderColor: "var(--idv-line)" }}
            />
            <figcaption
              className="text-[11px]"
              style={{ color: "var(--idv-muted)" }}
            >
              {sideLabel(doc, "front", isAr)}
            </figcaption>
          </figure>
        )}
        {backUrl && (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu blob local */}
            <img
              src={backUrl}
              alt={tr("Aperçu du verso", "معاينة الوجه الخلفي")}
              className="w-full rounded-[14px] border"
              style={{ borderColor: "var(--idv-line)" }}
            />
            <figcaption
              className="text-[11px]"
              style={{ color: "var(--idv-muted)" }}
            >
              {tr("Verso", "الوجه الخلفي")}
            </figcaption>
          </figure>
        )}
      </div>

      {state.error && !errorDismissed && (
        <p
          className="rounded-[12px] px-3 py-2.5 text-sm"
          style={{
            background: "rgba(239,68,68,.12)",
            color: "var(--idv-bad)",
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
          style={{ borderColor: "var(--idv-line)", color: "var(--idv-ink)" }}
        >
          <RefreshCcw className="size-4" />
          {tr("Reprendre", "إعادة الالتقاط")}
        </button>
        {needsBack ? (
          <button
            type="button"
            onClick={() => {
              setSide("back");
              setStep("capture");
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-sm font-semibold text-white"
            style={{ background: "var(--idv-accent)" }}
          >
            {tr("Scanner le verso", "مسح الوجه الخلفي")}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={pending || !captures.front}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--idv-accent)" }}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {tr("Analyse…", "جارٍ التحليل…")}
              </>
            ) : (
              <>
                <Send className="size-4 rtl:-scale-x-100" />
                {tr("Envoyer", "إرسال")}
              </>
            )}
          </button>
        )}
      </div>
    </IdvScope>
  );
}
