"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2, PartyPopper, Printer, Timer, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { formatDA } from "@/lib/utils";
import { updateOrderStatus } from "@/app/(merchant)/orders/actions";
import type { OrderStatus } from "@/lib/types";

export type NewOrder = {
  id: string;
  customer_name: string | null;
  total_da: number | null;
  /** Numéro de référence lisible (A042…) si présent dans le payload Realtime. */
  order_number?: string | null;
};

/** Délai (s) avant acceptation auto quand l'acceptation automatique est ON. */
const AUTO_ACCEPT_SECONDS = 10;
/** Délai (s) avant refus auto quand l'acceptation automatique est OFF. */
const AUTO_REFUSE_SECONDS = 15 * 60;

const REFUSAL_REASONS = [
  "Article(s) en rupture",
  "Trop de commandes (surcharge)",
  "Commerce fermé / fin de service",
  "Adresse hors zone de livraison",
  "Client injoignable",
  "Autre raison",
];

const AUTO_REFUSE_NOTE = "Refus automatique : non acceptée sous 15 min";

function opId(orderId: string, kind: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${kind}-${orderId}-${Date.now()}`;
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Props = {
  /** Commande en tête de file à afficher, ou `null` si aucune. */
  order: NewOrder | null;
  /** Nombre de commandes encore en attente DERRIÈRE celle affichée. */
  queued?: number;
  /** Acceptation automatique activée côté commerçant. */
  autoAccept: boolean;
  /** Appelé quand la commande est résolue (acceptée/refusée) → passe à la suivante. */
  onResolved: () => void;
  /** Impression manuelle du ticket (optionnel). */
  onPrint?: (orderId: string) => void;
  canPrint?: boolean;
};

/**
 * Overlay plein écran « Nouvelle commande ! » — affiché sur TOUTES les pages
 * commerçant dès qu'une commande arrive, où que soit le commerçant dans l'app.
 *
 * Deux modes selon le réglage « acceptation automatique » :
 *  - ON  : un bouton compte-à-rebours de 10 s. La commande est acceptée
 *          automatiquement à la fin, sauf si le commerçant la refuse avant
 *          (ou l'accepte tout de suite d'un tap).
 *  - OFF : boutons Accepter / Refuser. Un compte-à-rebours de 15 min : si la
 *          commande n'est pas acceptée à temps, elle est refusée automatiquement.
 *
 * Conçu pour être impossible à rater : plein écran, fond de marque, gros CTA,
 * responsive (pleine largeur mobile, centré desktop).
 */
export function NewOrderOverlay({
  order,
  queued = 0,
  autoAccept,
  onResolved,
  onPrint,
  canPrint = false,
}: Props) {
  const [acting, startActing] = useTransition();
  const [refusing, setRefusing] = useState(false);
  const initial = autoAccept ? AUTO_ACCEPT_SECONDS : AUTO_REFUSE_SECONDS;
  const [secondsLeft, setSecondsLeft] = useState(initial);

  // Garde anti double-résolution : une commande ne doit être acceptée/refusée
  // qu'une seule fois, même si le commerçant tape pile au moment où le
  // compte-à-rebours atteint 0.
  const resolvedRef = useRef(false);

  const orderId = order?.id ?? null;

  // Bloque le scroll du body tant que l'overlay est ouvert.
  useEffect(() => {
    if (!orderId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [orderId]);

  const accept = useCallback(() => {
    if (!orderId || resolvedRef.current) return;
    resolvedRef.current = true;
    startActing(async () => {
      const res = await updateOrderStatus(
        orderId,
        "preparing" as OrderStatus,
        opId(orderId, "accept")
      );
      if (res.error) {
        toast.error(res.error);
        resolvedRef.current = false;
        return;
      }
      toast.success("Commande acceptée — en préparation");
      onResolved();
    });
  }, [orderId, onResolved]);

  const refuse = useCallback(
    (reason: string) => {
      if (!orderId || resolvedRef.current) return;
      resolvedRef.current = true;
      startActing(async () => {
        const res = await updateOrderStatus(
          orderId,
          "cancelled" as OrderStatus,
          opId(orderId, "refuse"),
          reason
        );
        if (res.error) {
          toast.error(res.error);
          resolvedRef.current = false;
          return;
        }
        toast.success("Commande refusée");
        onResolved();
      });
    },
    [orderId, onResolved]
  );

  // (Ré)initialise le compte-à-rebours à chaque nouvelle commande affichée et
  // décompte chaque seconde. À 0 : accepte (mode auto) ou refuse (mode manuel).
  useEffect(() => {
    if (!orderId) return;
    resolvedRef.current = false;
    setRefusing(false);
    setSecondsLeft(initial);

    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          if (autoAccept) accept();
          else refuse(AUTO_REFUSE_NOTE);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [orderId, autoAccept, initial, accept, refuse]);

  if (!order) return null;

  const title = order.order_number
    ? `Nouvelle commande ${order.order_number}`
    : "Nouvelle commande !";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Nouvelle commande reçue"
      className="bg-primary-700/95 fixed inset-0 z-[95] flex flex-col items-center justify-center px-6 py-8 backdrop-blur-sm"
    >
      {queued > 0 && (
        <span className="absolute top-4 left-4 inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
          +{queued} en attente
        </span>
      )}

      <div className="animate-pulse">
        <PartyPopper className="text-warning-500 mx-auto size-16" />
      </div>

      <h2 className="mt-6 text-center text-2xl font-bold text-white sm:text-3xl">
        {title}
      </h2>

      <p className="mt-2 text-center text-base text-white/90">
        {order.customer_name ?? "Client"}
        {order.total_da != null && (
          <>
            <span className="px-2 text-white/60">·</span>
            <span className="font-semibold">{formatDA(order.total_da)}</span>
          </>
        )}
      </p>

      <div className="mt-8 flex w-full max-w-sm flex-col gap-2.5">
        {autoAccept ? (
          <AutoAcceptControls
            secondsLeft={secondsLeft}
            acting={acting}
            onAcceptNow={accept}
            onRefuse={() => refuse("Refusée par le commerçant")}
          />
        ) : refusing ? (
          <RefuseReasons
            acting={acting}
            onPick={refuse}
            onCancel={() => setRefusing(false)}
          />
        ) : (
          <ManualControls
            secondsLeft={secondsLeft}
            acting={acting}
            onAccept={accept}
            onRefuse={() => setRefusing(true)}
          />
        )}

        {/* Liens secondaires : voir le détail + impression manuelle. */}
        {!refusing && (
          <div className="mt-2 flex items-center justify-center gap-4">
            <Link
              href={`/orders/${order.id}`}
              className="text-sm font-medium text-white/80 underline-offset-4 hover:text-white hover:underline"
            >
              Voir le détail
            </Link>
            {canPrint && onPrint && (
              <button
                type="button"
                onClick={() => onPrint(order.id)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-white/80 hover:text-white"
              >
                <Printer className="size-4" />
                Imprimer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Mode acceptation automatique : un seul gros bouton compte-à-rebours. */
function AutoAcceptControls({
  secondsLeft,
  acting,
  onAcceptNow,
  onRefuse,
}: {
  secondsLeft: number;
  acting: boolean;
  onAcceptNow: () => void;
  onRefuse: () => void;
}) {
  const pct = Math.max(
    0,
    Math.min(100, (secondsLeft / AUTO_ACCEPT_SECONDS) * 100)
  );
  return (
    <>
      <button
        type="button"
        onClick={onAcceptNow}
        disabled={acting}
        className="text-primary-700 relative inline-flex h-14 w-full items-center justify-center overflow-hidden rounded-[14px] bg-white px-5 text-base font-bold shadow-lg hover:bg-white/90 disabled:opacity-70"
      >
        {/* Barre de progression du compte-à-rebours (se vide en 10 s). */}
        <span
          aria-hidden
          className="bg-success-500/25 absolute inset-y-0 left-0 transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
        <span className="relative inline-flex items-center gap-2">
          {acting ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Check className="size-5" />
          )}
          {acting
            ? "Acceptation…"
            : `Acceptée automatiquement dans ${secondsLeft}s`}
        </span>
      </button>
      <p className="text-center text-xs text-white/70">
        Acceptation automatique activée · touchez pour accepter tout de suite
      </p>
      <button
        type="button"
        onClick={onRefuse}
        disabled={acting}
        className="mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-white/30 px-5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50"
      >
        <X className="size-4" />
        Refuser plutôt
      </button>
    </>
  );
}

/** Mode manuel : Accepter / Refuser + compte-à-rebours avant refus auto. */
function ManualControls({
  secondsLeft,
  acting,
  onAccept,
  onRefuse,
}: {
  secondsLeft: number;
  acting: boolean;
  onAccept: () => void;
  onRefuse: () => void;
}) {
  // Alerte visuelle quand il reste moins de 2 min.
  const urgent = secondsLeft <= 120;
  return (
    <>
      <button
        type="button"
        onClick={onAccept}
        disabled={acting}
        className="bg-success-600 hover:bg-success-700 inline-flex h-14 w-full items-center justify-center gap-2 rounded-[14px] px-5 text-base font-bold text-white shadow-lg disabled:opacity-60"
      >
        {acting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Check className="size-5" />
        )}
        Accepter
      </button>
      <button
        type="button"
        onClick={onRefuse}
        disabled={acting}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] border border-white/40 px-5 text-base font-semibold text-white hover:bg-white/10 disabled:opacity-50"
      >
        <X className="size-5" />
        Refuser
      </button>
      <p
        className={
          "mt-1 inline-flex items-center justify-center gap-1.5 text-center text-xs " +
          (urgent ? "text-warning-100 font-semibold" : "text-white/70")
        }
      >
        <Timer className="size-3.5" />
        Refus automatique dans {mmss(secondsLeft)} si non acceptée
      </p>
    </>
  );
}

/** Liste des motifs de refus (mode manuel). */
function RefuseReasons({
  acting,
  onPick,
  onCancel,
}: {
  acting: boolean;
  onPick: (reason: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-[14px] bg-white p-3 shadow-lg">
      <p className="text-muted px-1 pb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        Motif du refus
      </p>
      <ul className="space-y-0.5">
        {REFUSAL_REASONS.map((r) => (
          <li key={r}>
            <button
              type="button"
              onClick={() => onPick(r)}
              disabled={acting}
              className="hover:bg-danger-50 text-foreground flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left text-sm disabled:opacity-50"
            >
              {r}
              {acting && <Loader2 className="size-4 animate-spin" />}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onCancel}
        disabled={acting}
        className="text-muted mt-1.5 w-full rounded-[10px] px-2 py-1.5 text-center text-xs hover:underline disabled:opacity-50"
      >
        Annuler
      </button>
    </div>
  );
}
