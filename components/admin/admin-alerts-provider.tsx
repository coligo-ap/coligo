"use client";

import { createContext, useContext, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { AdminAlert } from "@/lib/alerts/alert-model";

// =============================================================================
// Provider TanStack des ALERTES super-admin — monté UNE FOIS dans le layout
// /admin. Le QueryClient survit aux navigations (le layout ne se re-monte pas)
// → badges/cloche se réaffichent instantanément depuis le cache puis se
// rafraîchissent en silence. Live = refetch au focus + poll léger 60 s.
//
// Données initiales hydratées depuis le serveur (`initial`) → aucun flash, et
// le 1er rendu montre déjà l'état réel. Sécurité : l'endpoint /api/admin/alerts
// est doublement gardé (isSuperAdmin + RPC) ; aucune PII ne transite.
// =============================================================================

type Ctx = { alerts: AdminAlert[]; isFetching: boolean };
const AlertsContext = createContext<Ctx>({ alerts: [], isFetching: false });

/** Hook de lecture des alertes (drawer, sidebar, mobile-nav, cloche). */
export function useAdminAlerts(): Ctx {
  return useContext(AlertsContext);
}

function AlertsInner({
  initial,
  children,
}: {
  initial?: AdminAlert[];
  children: React.ReactNode;
}) {
  const { data, isFetching } = useQuery<AdminAlert[]>({
    queryKey: ["admin-alerts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`alerts ${res.status}`);
      return (await res.json()) as AdminAlert[];
    },
    // Données initiales optionnelles. Sans hydratation serveur (cas par défaut,
    // pour ne pas ralentir le rendu des pages admin), on marque la donnée comme
    // PÉRIMÉE (`initialDataUpdatedAt: 0`) → fetch immédiat au montage, mais NON
    // bloquant : la page est déjà affichée, les badges suivent ~aussitôt.
    initialData: initial ?? [],
    initialDataUpdatedAt: initial && initial.length ? Date.now() : 0,
    staleTime: 45_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  return (
    <AlertsContext.Provider value={{ alerts: data ?? [], isFetching }}>
      {children}
    </AlertsContext.Provider>
  );
}

export function AdminAlertsProvider({
  initial,
  children,
}: {
  initial?: AdminAlert[];
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, gcTime: 5 * 60_000 },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <AlertsInner initial={initial}>{children}</AlertsInner>
    </QueryClientProvider>
  );
}
