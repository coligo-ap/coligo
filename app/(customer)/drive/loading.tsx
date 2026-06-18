/**
 * Squelette de l'espace Drive CLIENT (réservation de course). Frontière propre
 * au sous-segment `/drive` pour ne pas afficher le squelette « marketplace » du
 * groupe client. Carte + feuille de réservation → transition instantanée.
 */
export default function DriveLoading() {
  return (
    <div className="drive-jakarta relative min-h-[100dvh] bg-[var(--d-page)]">
      <div className="absolute inset-0 bg-[var(--d-page)]" />
      <div className="absolute top-[64px] right-4 size-[42px] animate-pulse rounded-full bg-[var(--d-surface)] shadow" />
      <div className="absolute right-0 bottom-0 left-0 rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3 pb-8">
        <span className="mx-auto mb-3 block h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
        <div className="h-7 w-44 animate-pulse rounded-lg bg-[var(--d-soft)]" />
        <div className="mt-3 h-[54px] w-full animate-pulse rounded-[16px] bg-[var(--d-soft)]" />
        <div className="mt-2 h-[54px] w-full animate-pulse rounded-[16px] bg-[var(--d-soft)]" />
        <div className="mt-3 h-[52px] w-full animate-pulse rounded-[18px] bg-[var(--d-soft)]" />
      </div>
    </div>
  );
}
