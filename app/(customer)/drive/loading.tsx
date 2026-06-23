import { Loader2 } from "lucide-react";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

/**
 * Squelette de l'espace Drive CLIENT. NEUTRE volontairement (en-tête + loader
 * centré) : tant que le serveur n'a pas tranché, on ne sait pas s'il faut
 * afficher le formulaire OU une course en cours — on n'affiche donc NI l'un NI
 * l'autre (pas de « fausse » barre de recherche qui clignote avant l'écran de
 * course).
 *
 * On rend AUSSI la barre du bas (`CustomerBottomNav`) — `/drive` étant `bare`,
 * la nav du chrome se démonte à l'entrée ; la garder ici évite qu'elle
 * « disparaisse » pendant le chargement.
 */
export default function DriveLoading() {
  return (
    <div className="drive-jakarta drive-screen z-40 flex min-h-[100dvh] flex-col bg-[var(--d-page)]">
      <header className="px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-1">
        <div className="flex items-center justify-between gap-2">
          <div className="h-4 w-32 animate-pulse rounded bg-[var(--d-soft)]" />
          <div className="flex items-center gap-1.5">
            <div className="h-7 w-20 animate-pulse rounded-full bg-[var(--d-soft)]" />
            <div className="size-8 animate-pulse rounded-full bg-[var(--d-soft)]" />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center pb-24">
        <Loader2
          className="size-7 animate-spin"
          style={{ color: "var(--d-accent, #6C2BD9)" }}
        />
      </main>

      <CustomerBottomNav />
    </div>
  );
}
