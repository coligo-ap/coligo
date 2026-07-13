import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

/**
 * Squelette de l'accueil Drive client — SOURCE UNIQUE, rendu par :
 *  1. `app/(customer)/drive/loading.tsx` (frontière RSC : navigation/refresh) ;
 *  2. `DriveView` tant que le contexte n'est pas chargé (`!ctx`).
 *
 * Avant, DriveView affichait un SPINNER PLEIN ÉCRAN sans la barre du bas : à
 * l'actualisation, la nav « disparaissait » entre le squelette de la frontière
 * et le montage du client (contrairement aux autres pages — Commandes… — où
 * tout le statique reste affiché). Un seul et même squelette aux deux étapes =
 * zéro saut visuel, la nav et la structure restent en continu.
 */
export function DriveHomeSkeleton() {
  return (
    <div className="drive-jakarta drive-screen z-40 flex min-h-[100dvh] flex-col bg-[var(--d-page)]">
      {/* En-tête (branding + chips) */}
      <header className="px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-1">
        <div className="flex items-center justify-between gap-2">
          <div className="h-4 w-32 animate-pulse rounded bg-[var(--d-soft)]" />
          <div className="flex items-center gap-1.5">
            <div className="h-7 w-20 animate-pulse rounded-full bg-[var(--d-soft)]" />
            <div className="size-8 animate-pulse rounded-full bg-[var(--d-soft)]" />
          </div>
        </div>
      </header>

      {/* Contenu : titre + assistant + carte formulaire */}
      <main className="flex-1 px-5 pb-24">
        <div className="mt-3 h-8 w-56 animate-pulse rounded-lg bg-[var(--d-soft)]" />
        <div className="mt-4 h-[52px] w-full animate-pulse rounded-[16px] bg-[var(--d-soft)]" />
        <div className="mt-3 rounded-[24px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4">
          <div className="h-[54px] w-full animate-pulse rounded-[15px] bg-[var(--d-soft)]" />
          <div className="mt-2 h-[54px] w-full animate-pulse rounded-[15px] bg-[var(--d-soft)]" />
          <div className="mt-3 h-[52px] w-full animate-pulse rounded-[18px] bg-[var(--d-soft)]" />
        </div>
      </main>

      <CustomerBottomNav />
    </div>
  );
}
