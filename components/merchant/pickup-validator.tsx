"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hash,
  Loader2,
  QrCode,
  XCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { enqueueOrExecute } from "@/lib/offline/queue";
import { QrScanner } from "@/components/scanner/qr-scanner";

type Tab = "code" | "qr";
/** `kind` pilote le TITRE du panneau de succès — chaque situation a son
 *  message : retrait validé ≠ commande simplement marquée prête ≠ action
 *  enregistrée hors ligne. */
type ResultKind = "completed" | "ready" | "queued" | "error";
type Result = {
  ok: boolean;
  kind: ResultKind;
  message: string;
  orderId?: string;
};

/**
 * Extrait un code 6 chiffres d'une string scannée. Le QR Coligo encode
 * directement les 6 chiffres ; par tolérance on accepte aussi une URL
 * legacy avec `?code=XXXXXX`. Tout autre format → `null`.
 *
 * Important : on ne fait PAS de `replace(/\D/g, "")` global sur l'input —
 * une URL avec shortRef alphanumérique (`1C747D`) contient des chiffres
 * parasites qui contamineraient le code (bug v3 résolu).
 */
function extractPickupCode(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  // Format dominant : 6 chiffres bruts (avec espaces internes tolérés)
  if (/^[\s\d]+$/.test(s)) {
    const digits = s.replace(/\D/g, "");
    return digits.length >= 4 && digits.length <= 6 ? digits : null;
  }
  // Tolérance URL legacy : on extrait le param `code`
  try {
    const url = new URL(s);
    const code = url.searchParams.get("code");
    if (code && /^\d{4,6}$/.test(code)) return code;
  } catch {
    /* pas une URL valide */
  }
  return null;
}

/**
 * Référence publique de commande — c'est ce qu'encode le QR IMPRIMÉ sur le
 * ticket (ex. « A042 », `#` toléré). Le serveur ne validera que si une seule
 * commande retrait PRÊTE du commerçant correspond.
 */
function extractOrderRef(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^#/, "").toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(s) && /\d/.test(s) ? s : null;
}

/** Vibration courte côté commerçant (silencieux sur iOS Safari). */
function buzz(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignored */
  }
}

/** Commande identifiée mais pas encore « prête » : contexte du pop-up choix. */
type ReadyPrompt = {
  /** Code/référence scanné(e) — resoumis(e) avec confirmReady. */
  code: string;
  orderId: string;
  orderNumber: string | null;
  customerName: string;
  statusLabel: string;
};

export function PickupValidator() {
  const [tab, setTab] = useState<Tab>("qr");
  const [result, setResult] = useState<Result | null>(null);
  const [readyPrompt, setReadyPrompt] = useState<ReadyPrompt | null>(null);
  const [pending, startTransition] = useTransition();
  // Remonte l'onglet actif (caméra + gardes anti-doublon) après avoir fermé
  // le pop-up d'erreur : le QrScanner est `oneShot` et se fige au 1er scan,
  // il faut donc le recréer pour pouvoir re-scanner.
  const [scanKey, setScanKey] = useState(0);

  // Ferme le pop-up d'erreur et réarme le scanner / la saisie pour un
  // nouvel essai.
  function dismissError() {
    setResult(null);
    setReadyPrompt(null);
    setScanKey((k) => k + 1);
  }

  function submit(code: string, confirmReady = false) {
    setResult(null);
    setReadyPrompt(null);
    startTransition(async () => {
      try {
        const outcome = await enqueueOrExecute({
          type: "validate_pickup",
          code,
          confirmReady,
        });
        if (outcome.mode === "queued") {
          // Hors ligne : on enregistre la validation et on confirmera au
          // commerçant que la synchro se fera dès le retour du réseau.
          // Pas d'orderId à afficher (on n'a pas interrogé la DB).
          buzz(60);
          setResult({
            ok: true,
            kind: "queued",
            message:
              "Vous êtes hors ligne : le retrait sera validé automatiquement dès le retour du réseau.",
          });
          return;
        }
        const res = outcome.result;
        // Commande trouvée mais pas encore « prête » → pop-up de CHOIX (pas
        // une impasse) : marquer prête seulement, ou prête + retrait.
        if (res.needsReady) {
          buzz(40);
          setReadyPrompt({
            code,
            orderId: res.needsReady.orderId,
            orderNumber: res.needsReady.orderNumber,
            customerName: res.needsReady.customerName,
            statusLabel: res.needsReady.statusLabel,
          });
          return;
        }
        const ok = !res.error;
        buzz(ok ? 60 : [80, 60, 80]);
        setResult({
          ok,
          kind: ok ? "completed" : "error",
          message: res.error ?? res.success ?? "",
          orderId: res.orderId,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur inattendue.";
        buzz([80, 60, 80]);
        setResult({ ok: false, kind: "error", message });
      }
    });
  }

  // « Marquer prête » SEULEMENT : la commande passe en prête (le client est
  // notifié) — le retrait sera validé plus tard, quand le client se présente.
  function markReadyOnly(prompt: ReadyPrompt) {
    setReadyPrompt(null);
    startTransition(async () => {
      try {
        const outcome = await enqueueOrExecute({
          type: "update_status",
          orderId: prompt.orderId,
          to: "ready",
        });
        if (outcome.mode === "queued") {
          buzz(60);
          setResult({
            ok: true,
            kind: "queued",
            message:
              "Vous êtes hors ligne : la commande sera marquée prête dès le retour du réseau.",
          });
          return;
        }
        const res = outcome.result;
        const ok = !res.error;
        buzz(ok ? 60 : [80, 60, 80]);
        setResult({
          ok,
          kind: ok ? "ready" : "error",
          message: ok
            ? `La commande ${prompt.orderNumber ? `#${prompt.orderNumber} ` : ""}de ${prompt.customerName} est marquée prête et le client est prévenu. Le retrait reste À VALIDER quand il récupère sa commande.`
            : (res.error ?? ""),
          orderId: prompt.orderId,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur inattendue.";
        buzz([80, 60, 80]);
        setResult({ ok: false, kind: "error", message });
      }
    });
  }

  return (
    <div className="mx-auto max-w-md">
      {/* Onglets */}
      <div className="bg-surface-3 mb-6 grid grid-cols-2 gap-1 rounded-md p-1">
        <TabButton active={tab === "code"} onClick={() => setTab("code")}>
          <Hash className="size-4" />
          Code
        </TabButton>
        <TabButton active={tab === "qr"} onClick={() => setTab("qr")}>
          <QrCode className="size-4" />
          Scanner QR
        </TabButton>
      </div>

      {result?.ok ? (
        <SuccessPanel result={result} onReset={dismissError} />
      ) : tab === "code" ? (
        <CodeTab key={scanKey} pending={pending} onSubmit={submit} />
      ) : (
        <QrTab key={scanKey} pending={pending} onScan={submit} />
      )}

      {/* Pop-up d'erreur en SURIMPRESSION : les messages (« Cette commande a
          déjà été récupérée », code invalide, etc.) passaient inaperçus en bas
          de la carte de scan. On les remonte dans une modale qui se superpose
          à l'affichage pour forcer l'attention du commerçant. */}
      {result && !result.ok && (
        <ErrorModal message={result.message} onDismiss={dismissError} />
      )}

      {/* Pop-up de CHOIX « pas encore prête » : le scan a identifié la
          commande, mais le commerçant ne l'a pas marquée prête. Deux issues
          au lieu d'une impasse : prête seulement, ou prête + retrait. */}
      {readyPrompt && (
        <ReadyPromptModal
          prompt={readyPrompt}
          pending={pending}
          onMarkReady={() => markReadyOnly(readyPrompt)}
          onMarkReadyAndComplete={() => submit(readyPrompt.code, true)}
          onDismiss={dismissError}
        />
      )}
    </div>
  );
}

/* --------------------- Pop-up « pas encore prête » ------------------------ */

function ReadyPromptModal({
  prompt,
  pending,
  onMarkReady,
  onMarkReadyAndComplete,
  onDismiss,
}: {
  prompt: ReadyPrompt;
  pending: boolean;
  onMarkReady: () => void;
  onMarkReadyAndComplete: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/50 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      role="alertdialog"
      aria-modal="true"
      onClick={onDismiss}
    >
      <div
        className="bg-surface border-border w-full max-w-sm rounded-2xl border p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-warning-50 mx-auto mb-4 flex size-14 items-center justify-center rounded-full">
          <AlertTriangle className="text-warning-600 size-8" />
        </div>
        <p className="text-foreground text-lg font-semibold">
          Commande pas encore marquée prête
        </p>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          La commande {prompt.orderNumber ? `#${prompt.orderNumber} ` : ""}
          de{" "}
          <span className="text-foreground font-semibold">
            {prompt.customerName}
          </span>{" "}
          est encore « {prompt.statusLabel} ». Vous pouvez la marquer prête, ou
          tout faire d&apos;un coup si le client est devant vous.
        </p>
        {/* Deux issues SUR LA MÊME LIGNE, couleurs distinctes : ambre = juste
            prête (étape intermédiaire), vert = prête + retrait (finalisé). */}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onMarkReady}
            className="bg-warning-500 hover:bg-warning-600 text-body-sm flex min-h-12 items-center justify-center rounded-md px-2 text-center leading-tight font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            Marquer prête
            <br />
            seulement
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onMarkReadyAndComplete}
            className="bg-success-600 hover:bg-success-700 text-body-sm flex min-h-12 items-center justify-center rounded-md px-2 text-center leading-tight font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            Prête + valider
            <br />
            le retrait
          </button>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted hover:text-foreground mt-3 text-sm font-medium"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

/* -------------------------------- Pop-up erreur --------------------------- */

function ErrorModal({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/50 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      role="alertdialog"
      aria-modal="true"
      onClick={onDismiss}
    >
      <div
        className="bg-surface border-border w-full max-w-sm rounded-2xl border p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-danger-50 mx-auto mb-4 flex size-14 items-center justify-center rounded-full">
          <XCircle className="text-danger-600 size-8" />
        </div>
        <p className="text-foreground text-lg font-semibold">
          Retrait impossible
        </p>
        <p className="text-muted mt-2 text-sm leading-relaxed">{message}</p>
        <Button size="lg" className="mt-6 w-full" onClick={onDismiss}>
          Réessayer
        </Button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-chip flex h-10 items-center justify-center gap-2 text-sm font-medium transition-colors",
        active
          ? "text-primary-700 bg-white shadow-sm"
          : "text-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------- Onglet code ------------------------------ */

function CodeTab({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (code: string) => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(4).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  function setDigit(i: number, value: string) {
    const d = value.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = d;
      return next;
    });
    if (d && i < 3) inputs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 4);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(4).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    inputs.current[Math.min(pasted.length, 3)]?.focus();
  }

  const code = digits.join("");
  const complete = code.length === 4;

  return (
    <div className="border-border bg-surface rounded-lg border p-5">
      <p className="text-muted mb-4 text-center text-sm">
        Saisissez le code à 4 chiffres présenté par le client.
      </p>

      <div className="mb-5 flex justify-center gap-2" onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            inputMode="numeric"
            maxLength={1}
            autoFocus={i === 0}
            disabled={pending}
            aria-label={`Chiffre ${i + 1}`}
            className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 size-12 rounded-md border text-center text-xl font-semibold tabular-nums focus:ring-2 focus:outline-none disabled:opacity-50"
          />
        ))}
      </div>

      <Button
        size="lg"
        className="w-full"
        disabled={!complete || pending}
        onClick={() => onSubmit(code)}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        Valider la remise
      </Button>
    </div>
  );
}

/* -------------------------------- Onglet QR ------------------------------- */

function QrTab({
  pending,
  onScan,
}: {
  pending: boolean;
  onScan: (code: string) => void;
}) {
  // On déduplique côté wrapper : QrScanner peut émettre plusieurs fois si on
  // le passe en non-oneShot ailleurs, et même en oneShot on se prémunit contre
  // un second appel concurrent.
  const handledRef = useRef(false);

  const handleScan = useCallback(
    (text: string) => {
      if (handledRef.current) return;
      // Deux QR acceptés : le QR CLIENT (code PIN 4-6 chiffres, URLs legacy
      // `?code=` tolérées) et le QR du TICKET imprimé (référence publique
      // « A042 »). (NE PAS faire un `replace(/\D/g, "")` global : un shortRef
      // alphanum avec chiffres parasites contamine le code.)
      const code = extractPickupCode(text);
      const value = code ?? extractOrderRef(text);
      if (!value) return; // format inconnu : on laisse le commerçant retenter
      handledRef.current = true;
      onScan(value);
    },
    [onScan]
  );

  return (
    <div className="border-border bg-surface rounded-lg border p-5">
      <p className="text-muted mb-4 text-center text-sm">
        Scannez le QR du client ou celui du ticket imprimé.
      </p>

      <div className="relative">
        <QrScanner onScan={handleScan} oneShot className="max-w-[280px]" />
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Succès ----------------------------------- */

function SuccessPanel({
  result,
  onReset,
}: {
  result: Result;
  onReset: () => void;
}) {
  // Chaque situation a SON message : un retrait validé n'est pas la même
  // chose qu'une commande simplement marquée prête, ni qu'une action mise en
  // file hors ligne. Titre + ton + libellé du bouton adaptés.
  const meta =
    result.kind === "ready"
      ? {
          title: "Commande marquée prête",
          tone: "warning" as const,
          again: "Scanner une autre commande",
        }
      : result.kind === "queued"
        ? {
            title: "Enregistré — en attente de réseau",
            tone: "warning" as const,
            again: "Scanner une autre commande",
          }
        : {
            title: "Retrait validé",
            tone: "success" as const,
            again: "Valider un autre retrait",
          };
  const isWarn = meta.tone === "warning";
  return (
    <div
      className={cn(
        "rounded-lg border p-6 text-center",
        isWarn
          ? "border-warning-200 bg-warning-50"
          : "border-success-200 bg-success-50"
      )}
    >
      {isWarn ? (
        <Clock className="text-warning-600 mx-auto mb-3 size-12" />
      ) : (
        <CheckCircle2 className="text-success-600 mx-auto mb-3 size-12" />
      )}
      <p
        className={cn(
          "text-lg font-semibold",
          isWarn ? "text-warning-800" : "text-success-800"
        )}
      >
        {meta.title}
      </p>
      <p
        className={cn(
          "mt-1 text-sm",
          isWarn ? "text-warning-700" : "text-success-700"
        )}
      >
        {result.message}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {result.orderId && (
          <Link
            href={`/orders/${result.orderId}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "w-full"
            )}
          >
            Voir la commande
          </Link>
        )}
        <Button size="lg" className="w-full" onClick={onReset}>
          {meta.again}
        </Button>
      </div>
    </div>
  );
}
