/** Squelette de l'écran de suivi de l'inscription. */
export default function DriverPendingLoading() {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-page)]">
      <main className="mx-auto max-w-md space-y-3 px-5 pt-8">
        <div className="flex flex-col items-center gap-2">
          <div className="size-14 animate-pulse rounded-full bg-[var(--soft)]" />
          <div className="h-6 w-56 animate-pulse rounded-lg bg-[var(--soft)]" />
        </div>
        <div className="h-64 animate-pulse rounded-[18px] bg-[var(--soft)]" />
        <div className="h-16 animate-pulse rounded-[14px] bg-[var(--soft)]" />
        <div className="h-16 animate-pulse rounded-[14px] bg-[var(--soft)]" />
      </main>
    </div>
  );
}
