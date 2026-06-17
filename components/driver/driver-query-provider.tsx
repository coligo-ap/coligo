"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Provider TanStack Query de l'espace livreur — monté UNE SEULE FOIS dans
 * DriverThemeRoot (layout), il survit donc aux navigations client-side entre
 * onglets. Conséquence : les données (gains, profil…) lues via useQuery se
 * réaffichent INSTANTANÉMENT depuis le cache au retour sur un onglet, puis se
 * rafraîchissent en silence si périmées.
 *
 * Sécurité : le cache vit uniquement en mémoire de l'onglet courant et chaque
 * requête est ré-authentifiée côté serveur (server action → getCurrentDriver +
 * RLS). Les clés de cache incluent toujours l'id du livreur (cf. useQuery), donc
 * aucune donnée d'un autre compte ne peut être servie depuis le cache.
 */
export function DriverQueryProvider({
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
