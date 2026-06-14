"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  RefreshCw,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useOfflineSync,
  useOnActionResolved,
} from "@/lib/hooks/use-offline-sync";
import {
  discardAction,
  getPendingActions,
  retryAction,
  subscribeToQueueChange,
} from "@/lib/offline/queue";
import { toast } from "@/components/ui/toast";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import type {
  PendingAction,
  UpdateStatusPayload,
  ValidatePickupPayload,
} from "@/lib/offline/db";
import { useRouter } from "next/navigation";

/**
 * Indicateur d'état de connexion + de la file d'actions différées.
 *
 * - En ligne, file vide → pastille verte « En ligne » (très discret).
 * - Hors ligne → pastille orange « Hors ligne — N en attente ».
 * - Synchronisation en cours → pastille bleue.
 * - Échecs → bouton « N en échec » qui ouvre la liste avec « réessayer » /
 *   « abandonner » par action.
 *
 * Réagit aux résolutions d'actions :
 *   - succès → toast + router.refresh (Realtime aussi va se déclencher)
 *   - conflit → toast d'info clair
 *   - failed → toast d'erreur (l'utilisateur peut rejouer via le panneau)
 */
export function SyncIndicator() {
  const router = useRouter();
  const { online, pendingCount, failedCount, syncing } = useOfflineSync();
  const [open, setOpen] = useState(false);

  // Refresh les routes serveur dès qu'une action est validée par le serveur.
  // (Realtime déclenchera aussi un refresh, mais on s'assure que ça arrive
  // même si Realtime est en reconnexion.)
  const handleResolved = useCallback(
    (detail: {
      result: "success" | "conflict" | "failed";
      message: string;
    }) => {
      if (detail.result === "success") {
        toast.success(
          detail.message === "Déjà appliqué."
            ? "Action déjà synchronisée."
            : "Action synchronisée."
        );
        router.refresh();
      } else if (detail.result === "conflict") {
        toast.info(`Cette commande a déjà été mise à jour : ${detail.message}`);
        router.refresh();
      } else {
        toast.error(`Synchronisation échouée : ${detail.message}`);
      }
    },
    [router]
  );
  useOnActionResolved(handleResolved);

  // Auto-fermer le panneau si plus rien à montrer (ni pending ni failed).
  useEffect(() => {
    if (pendingCount === 0 && failedCount === 0) setOpen(false);
  }, [pendingCount, failedCount]);

  const showsAnything = !online || pendingCount > 0 || failedCount > 0;

  // Pastille principale
  const pill = (() => {
    if (!online) {
      return {
        tone: "warning" as const,
        icon: CloudOff,
        label:
          pendingCount > 0
            ? `Hors ligne — ${pendingCount} en attente`
            : "Hors ligne",
      };
    }
    if (syncing && pendingCount > 0) {
      return {
        tone: "primary" as const,
        icon: Loader2,
        label: "Synchronisation…",
        spin: true,
      };
    }
    if (pendingCount > 0) {
      return {
        tone: "primary" as const,
        icon: Loader2,
        label: `${pendingCount} en attente`,
        spin: true,
      };
    }
    if (failedCount > 0) {
      return {
        tone: "danger" as const,
        icon: AlertTriangle,
        label: `${failedCount} en échec`,
      };
    }
    return {
      tone: "success" as const,
      icon: CheckCircle2,
      label: "En ligne",
    };
  })();

  if (!showsAnything) {
    // Très discret quand tout va bien : seulement visible si on a quelque
    // chose à signaler. Évite le bruit visuel permanent.
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
          PILL_STYLES[pill.tone]
        )}
        aria-expanded={open}
        aria-label={pill.label}
      >
        <pill.icon
          className={cn("size-3.5", pill.spin ? "animate-spin" : undefined)}
        />
        <span className="hidden sm:inline">{pill.label}</span>
      </button>

      {open && (
        <SyncPanel
          online={online}
          pendingCount={pendingCount}
          failedCount={failedCount}
          syncing={syncing}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const PILL_STYLES: Record<
  "success" | "primary" | "warning" | "danger",
  string
> = {
  success: "border-success-200 bg-success-50 text-success-700",
  primary: "border-primary-200 bg-primary-50 text-primary-700",
  warning: "border-warning-200 bg-warning-50 text-warning-800",
  danger: "border-danger-200 bg-danger-50 text-danger-700",
};

// ---------------------------------------------------------------------------
// Panneau : liste des actions, retry / discard
// ---------------------------------------------------------------------------

function SyncPanel({
  online,
  pendingCount,
  failedCount,
  syncing,
  onClose,
}: {
  online: boolean;
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
  onClose: () => void;
}) {
  const [actions, setActions] = useState<PendingAction[]>([]);

  // Charge la liste + se met à jour à chaque changement de file.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await getPendingActions();
      if (!cancelled) setActions(list);
    };
    void refresh();
    const off = subscribeToQueueChange(() => void refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return (
    <div
      className="border-border bg-surface fixed top-[calc(env(safe-area-inset-top)+3.5rem)] right-2 z-50 w-[min(18rem,calc(100vw-1rem))] rounded-[14px] border p-3 shadow-xl lg:absolute lg:top-full lg:right-0 lg:mt-2 lg:w-80"
      role="dialog"
    >
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Synchronisation</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="text-subtle hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <p className="text-muted mb-3 inline-flex items-center gap-1.5 text-xs">
        {online ? (
          <>
            <Wifi className="text-success-600 size-3.5" />
            En ligne
          </>
        ) : (
          <>
            <CloudOff className="text-warning-600 size-3.5" />
            Hors ligne — les actions seront envoyées au retour du réseau.
          </>
        )}
      </p>

      {actions.length === 0 ? (
        <p className="text-subtle py-4 text-center text-xs">
          Aucune action en attente.
        </p>
      ) : (
        <ul className="divide-border max-h-80 divide-y overflow-y-auto">
          {actions.map((a) => (
            <ActionRow key={a.id} action={a} />
          ))}
        </ul>
      )}

      {(pendingCount > 0 || syncing) && (
        <p className="text-subtle mt-2 text-[11px]">
          {pendingCount} action(s) seront envoyées dans l&apos;ordre.
        </p>
      )}
      {failedCount > 0 && (
        <p className="text-danger-700 mt-1 text-[11px]">
          {failedCount} en échec — réessayez ou abandonnez ci-dessus.
        </p>
      )}
    </div>
  );
}

function ActionRow({ action }: { action: PendingAction }) {
  const label = describeAction(action);

  return (
    <li className="flex items-start gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-subtle text-[11px]">
          {STATUS_LABEL[action.status]} · tentatives : {action.attempts}
          {action.lastError ? ` · ${action.lastError}` : ""}
        </p>
      </div>
      {action.status === "failed" && (
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => {
              void retryAction(action.id);
            }}
            className="text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11px] font-medium"
            aria-label="Réessayer"
          >
            <RefreshCw className="size-3.5" />
            Réessayer
          </button>
          <button
            type="button"
            onClick={() => {
              void discardAction(action.id);
            }}
            className="text-danger-700 hover:bg-danger-50 inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11px] font-medium"
            aria-label="Abandonner"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

const STATUS_LABEL: Record<PendingAction["status"], string> = {
  queued: "En attente",
  syncing: "Envoi en cours…",
  failed: "Échec",
};

function describeAction(action: PendingAction): string {
  if (action.type === "update_status") {
    const p = action.payload as UpdateStatusPayload;
    const meta = ORDER_STATUS_META[p.to as OrderStatus];
    const short = p.orderId.slice(0, 6).toUpperCase();
    return `Commande #${short} → ${meta?.label ?? p.to}`;
  }
  const p = action.payload as ValidatePickupPayload;
  return `Validation retrait code ${p.code}`;
}
