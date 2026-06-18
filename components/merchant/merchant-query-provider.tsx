"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Provider TanStack Query de l'espace COMMERÇANT — monté UNE SEULE FOIS dans
 * MerchantShell (coque partagée par toutes les sections). Comme la coque ne se
 * re-monte pas entre sections, le QueryClient (et le cache) SURVIT aux
 * navigations : les listes lues via `useQuery` (catalogue…) se réaffichent
 * INSTANTANÉMENT au retour, puis se rafraîchissent en silence si périmées.
 *
 * Sécurité : cache en mémoire de l'onglet ; chaque requête est ré-authentifiée
 * côté serveur (RLS scope sur le commerçant connecté) et la clé inclut l'id du
 * commerçant → aucune fuite entre comptes.
 */
export function MerchantQueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
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
