import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

/**
 * Squelette de l'historique Drive. SANS lui, la page `force-dynamic` qui
 * `await getDriveHistory()` BLOQUE la navigation (le tap « ne fait rien » tant
 * que le serveur n'a pas répondu) — d'où l'impression de devoir cliquer
 * plusieurs fois. Avec ce squelette, l'écran apparaît INSTANTANÉMENT au tap puis
 * les données se streament. La barre du bas est rendue (comme /drive est `bare`)
 * pour rester visible en continu.
 */
export default function DriveHistoriqueLoading() {
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      {/* En-tête : retour + titre */}
      <div className="mb-3 flex items-center gap-3">
        <div className="size-9 animate-pulse rounded-full bg-[var(--d-soft)]" />
        <div className="h-6 w-40 animate-pulse rounded-lg bg-[var(--d-soft)]" />
      </div>

      {/* Onglets Courses / Favoris */}
      <div className="mb-4 flex gap-2">
        <div className="h-9 w-28 animate-pulse rounded-full bg-[var(--d-soft)]" />
        <div className="h-9 w-24 animate-pulse rounded-full bg-[var(--d-soft)]" />
      </div>

      {/* Lignes de courses */}
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-page)] p-3.5"
          >
            <div className="size-11 shrink-0 animate-pulse rounded-full bg-[var(--d-soft)]" />
            <div className="min-w-0 flex-1">
              <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--d-soft)]" />
              <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-[var(--d-soft)]" />
            </div>
            <div className="h-5 w-16 animate-pulse rounded bg-[var(--d-soft)]" />
          </div>
        ))}
      </div>

      <CustomerBottomNav />
    </div>
  );
}
