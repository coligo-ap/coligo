import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

/**
 * Squelette de l'espace Drive CLIENT. Reflète le NOUVEL accueil Drive (sans
 * carte) : en-tête branding + chips, titre, barre assistant, carte formulaire.
 *
 * IMPORTANT : on rend AUSSI la barre du bas (`CustomerBottomNav`) — comme
 * `/drive` est `bare`, la nav du chrome se démonte à l'entrée ; sans elle ici la
 * barre « disparaissait » pendant le chargement. La rendre dans le squelette la
 * garde visible en continu → transition sans clignotement.
 */
export default function DriveLoading() {
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
