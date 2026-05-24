"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Inbox, RefreshCw, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getCachedOrders, getLastSyncAt } from "@/lib/offline/orders-cache";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import type { CachedOrder } from "@/lib/offline/db";
import { cn, formatDA, formatRelativeTime, formatTime } from "@/lib/utils";

/**
 * Affichage dégradé sur /offline : lit IndexedDB et propose les dernières
 * commandes connues du commerçant. Lecture pure, aucune action.
 *
 * - Si pas de cache (commerçant qui n'a jamais ouvert le dashboard depuis
 *   cet appareil) → ne rien afficher (la page /offline standard suffit).
 * - Sinon → liste compacte des commandes par statut actif, avec mention
 *   « Dernière synchro : … ».
 */
export function OfflineOrdersFallback() {
  const [orders, setOrders] = useState<CachedOrder[] | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, sync] = [await getCachedOrders(), getLastSyncAt()];
      if (cancelled) return;
      setOrders(list);
      setLastSync(sync);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (orders === null) {
    // Chargement initial du cache — silencieux pour éviter un flash.
    return null;
  }

  // Le commerçant ne se concentre que sur les commandes encore en cours.
  const active = orders.filter(
    (o) => o.status !== "completed" && o.status !== "cancelled"
  );

  if (active.length === 0) {
    return null;
  }

  return (
    <section className="border-border bg-surface mt-6 w-full max-w-md rounded-[14px] border p-5 text-left">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <WifiOff className="text-warning-600 size-4" />
          <h2 className="text-sm font-semibold">Dernières commandes connues</h2>
        </div>
        {lastSync && (
          <span className="text-subtle text-[11px]">
            Synchro {formatRelativeTime(new Date(lastSync).toISOString())}
          </span>
        )}
      </header>

      <p className="text-muted mb-3 text-xs">
        Lecture seule — vos actions ne seront pas envoyées tant que le réseau
        n&apos;est pas revenu.
      </p>

      <ul className="divide-border divide-y">
        {active.slice(0, 12).map((o) => {
          const meta = ORDER_STATUS_META[o.status as OrderStatus];
          const shortId = o.id.slice(0, 6).toUpperCase();
          return (
            <li
              key={o.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold">
                    #{shortId}
                  </span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <p className="text-muted truncate text-xs">
                  {o.customer_name} · Retrait à {formatTime(o.pickup_slot_at)}
                </p>
              </div>
              <span className="text-foreground shrink-0 text-xs font-semibold tabular-nums">
                {formatDA(o.total_da)}
              </span>
            </li>
          );
        })}
      </ul>

      {active.length > 12 && (
        <p className="text-subtle mt-2 text-center text-[11px]">
          +{active.length - 12} commande(s) supplémentaire(s) dans le cache.
        </p>
      )}

      <Link
        href="/dashboard"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "mt-4 w-full"
        )}
      >
        <RefreshCw className="size-4" />
        Réessayer la connexion
      </Link>
    </section>
  );
}

export function EmptyOfflineHint() {
  return (
    <p className="text-subtle mt-4 inline-flex items-center gap-1.5 text-xs">
      <Inbox className="size-3.5" />
      Aucune commande en cache local sur cet appareil.
    </p>
  );
}
