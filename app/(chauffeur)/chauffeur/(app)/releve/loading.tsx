/** Squelette du relevé chauffeur (règle : toute route qui await = loading). */
export default function ChauffeurReleveLoading() {
  return (
    <div className="drive-jakarta pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <div className="mx-auto max-w-md space-y-3">
        <div className="rounded-card-lg h-10 animate-pulse bg-[var(--d-soft)]" />
        <div className="h-20 animate-pulse rounded-lg bg-[var(--d-soft)]" />
        <div className="rounded-sheet-xl h-32 animate-pulse bg-[var(--d-soft)]" />
        <div className="rounded-sheet-lg h-40 animate-pulse bg-[var(--d-soft)]" />
      </div>
    </div>
  );
}
