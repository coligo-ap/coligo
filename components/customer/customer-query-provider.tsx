"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Provider TanStack Query de l'espace CLIENT — monté UNE SEULE FOIS dans le
 * layout de groupe `(customer)/layout.tsx`. Comme le layout ne se re-monte pas
 * en naviguant entre pages client, le QueryClient (et donc le cache) SURVIT aux
 * navigations : les listes lues via `useQuery` se réaffichent INSTANTANÉMENT au
 * retour, puis se rafraîchissent en silence si périmées (au-delà du Router
 * Cache, et indépendamment de lui).
 *
 * Sécurité : cache en mémoire de l'onglet uniquement ; chaque requête est
 * ré-authentifiée côté serveur (server action → getCurrentCustomer + RLS) et la
 * clé de cache inclut toujours l'id du client → aucune fuite entre comptes.
 */
export function CustomerQueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Fraîcheur raisonnable : pas de refetch au montage tant que < 30 s.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
