import { DriverBottomNav } from "@/components/driver/driver-bottom-nav";

/**
 * Squelette de navigation INTRA-app livreur (Accueil/Gains/Historique/Compte).
 *
 * Pourquoi ce fichier : sans lui, la frontière de chargement la plus proche est
 * le splash plein écran `(driver)/loading.tsx` — qui s'affichait par-dessus
 * TOUTE l'app à chaque changement d'onglet (ressenti « relancement » de ~4 s,
 * le temps du rendu serveur dynamique). Ce loader-ci, placé au niveau du
 * segment `driver`, prend le dessus pour les navigations internes : on garde la
 * barre du bas et on n'affiche qu'un skeleton de contenu → transition perçue
 * instantanée (< 100 ms), les données arrivent ensuite en streaming. Le splash
 * de groupe ne sert plus qu'à la 1ʳᵉ entrée (depuis le portail commerçant).
 */
export default function DriverPagesLoading() {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-surface)]">
      <main className="mx-auto max-w-md px-5 pt-4 pb-24">
        <div className="space-y-4 pt-1">
          {/* En-tête (titre + action) */}
          <div className="flex items-center justify-between">
            <div className="h-7 w-36 animate-pulse rounded-lg bg-[var(--soft)]" />
            <div className="size-10 animate-pulse rounded-[13px] bg-[var(--soft)]" />
          </div>
          {/* Carte principale (hero / total) */}
          <div className="h-28 animate-pulse rounded-[18px] bg-[var(--soft)]" />
          {/* 3 cards-colonnes */}
          <div className="grid grid-cols-3 gap-2">
            <div className="h-20 animate-pulse rounded-[14px] bg-[var(--soft)]" />
            <div className="h-20 animate-pulse rounded-[14px] bg-[var(--soft)]" />
            <div className="h-20 animate-pulse rounded-[14px] bg-[var(--soft)]" />
          </div>
          {/* Lignes de liste */}
          <div className="h-16 animate-pulse rounded-[14px] bg-[var(--soft)]" />
          <div className="h-16 animate-pulse rounded-[14px] bg-[var(--soft)]" />
          <div className="h-16 animate-pulse rounded-[14px] bg-[var(--soft)]" />
        </div>
      </main>
      <DriverBottomNav />
    </div>
  );
}
