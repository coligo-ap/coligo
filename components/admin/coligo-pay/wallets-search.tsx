"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Bike,
  Car,
  ChevronRight,
  Loader2,
  Search,
  Store,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import type { WalletHit } from "@/app/admin/coligo-pay/portefeuilles/actions";

// =============================================================================
// Recherche UNIFIÉE des portefeuilles Coligo Pay : clients (Coligo Pay +
// cashback), livreurs / chauffeurs / commerçants (portefeuille opérateur) et
// AGENTS (partner). Résultat → fiche portefeuille. URL = source de vérité (q).
// =============================================================================

const KIND_META: Record<
  WalletHit["kind"],
  { label: string; icon: typeof User }
> = {
  client: { label: "Client", icon: User },
  driver: { label: "Livreur", icon: Bike },
  chauffeur: { label: "Chauffeur", icon: Car },
  merchant: { label: "Commerçant", icon: Store },
  partner: { label: "Agent Coligo Pay", icon: BadgeCheck },
};

export function WalletsSearch({
  initialQ,
  hits,
}: {
  initialQ: string;
  hits: WalletHit[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(initialQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (value: string) => {
    const qs = value.trim() ? `?q=${encodeURIComponent(value.trim())}` : "";
    startTransition(() => {
      router.replace(`/admin/coligo-pay/portefeuilles${qs}`, {
        scroll: false,
      });
    });
  };
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => apply(e.target.value), 400);
          }}
          placeholder="Nom, téléphone ou handle — client, livreur, chauffeur, commerçant, agent…"
          className="border-border bg-surface h-12 w-full rounded-md border pr-3 pl-10 text-sm outline-none"
        />
        {isPending && (
          <Loader2 className="text-muted absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
        )}
      </div>

      {initialQ.trim().length < 2 ? (
        <p className="text-muted py-10 text-center text-sm">
          Tape au moins 2 caractères pour chercher un portefeuille.
        </p>
      ) : hits.length === 0 ? (
        <p className="text-muted py-10 text-center text-sm">
          Aucun portefeuille ne correspond à « {initialQ} ».
        </p>
      ) : (
        <ul
          className={
            "space-y-2 transition-opacity " + (isPending ? "opacity-60" : "")
          }
        >
          {hits.map((h) => {
            const meta = KIND_META[h.kind];
            const Icon = meta.icon;
            const href =
              h.kind === "client"
                ? `/admin/coligo-pay/portefeuilles/client/${h.refId}`
                : `/admin/coligo-pay/portefeuilles/op/${h.refId}`;
            return (
              <li key={`${h.kind}-${h.refId}`}>
                <Link
                  href={href}
                  className="border-border bg-surface hover:border-primary-200 hover:bg-primary-50/30 rounded-card-lg flex items-center gap-3 border p-3.5 transition-colors"
                >
                  <span className="bg-surface-2 grid size-10 shrink-0 place-items-center rounded-full">
                    <Icon className="text-muted size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-bold">
                        {h.name}
                      </span>
                      <Badge tone="neutral">{meta.label}</Badge>
                      {h.status !== "active" && (
                        <Badge tone="danger">
                          {h.status === "suspended" ? "Suspendu" : h.status}
                        </Badge>
                      )}
                    </div>
                    {h.phone && (
                      <p className="text-muted mt-0.5 text-xs">{h.phone}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">
                      {formatDA(h.balanceDa)}
                    </p>
                    {h.kind === "client" && (
                      <p className="text-muted text-caption">
                        + {formatDA(h.cashbackDa)} cashback
                      </p>
                    )}
                  </div>
                  <ChevronRight className="text-subtle size-4 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
