// Squelette covoiturage (cache froid) : structure immédiate, données streamées.
export default function Loading() {
  return (
    <div className="drive-jakarta drive-screen z-40 min-h-[100dvh] bg-[var(--d-surface)] px-[18px] pt-[calc(16px+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2">
        <div className="size-9 animate-pulse rounded-md bg-[var(--d-soft)]" />
        <div className="h-6 w-40 animate-pulse rounded-sm bg-[var(--d-soft)]" />
      </div>
      <div className="mt-4 space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[110px] animate-pulse rounded-lg bg-[var(--d-soft)]"
          />
        ))}
      </div>
    </div>
  );
}
