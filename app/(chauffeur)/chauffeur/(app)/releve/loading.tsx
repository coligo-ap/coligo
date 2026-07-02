/** Squelette du relevé chauffeur (règle : toute route qui await = loading). */
export default function ChauffeurReleveLoading() {
  return (
    <div className="drive-jakarta min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      <div className="mx-auto max-w-md space-y-3">
        <div className="h-10 animate-pulse rounded-[14px] bg-[var(--d-soft)]" />
        <div className="h-20 animate-pulse rounded-[16px] bg-[var(--d-soft)]" />
        <div className="h-32 animate-pulse rounded-[22px] bg-[var(--d-soft)]" />
        <div className="h-40 animate-pulse rounded-[18px] bg-[var(--d-soft)]" />
      </div>
    </div>
  );
}
