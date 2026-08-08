/** Squelette de l'écran de félicitations / choix du mode d'activité. */
export default function DriverWelcomeLoading() {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-page)]">
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-3 px-5">
        <div className="mx-auto size-[180px] animate-pulse rounded-full bg-[var(--soft)]" />
        <div className="mx-auto h-7 w-56 animate-pulse rounded-lg bg-[var(--soft)]" />
        <div className="mx-auto h-4 w-72 animate-pulse rounded-lg bg-[var(--soft)]" />
        <div className="mt-4 h-[52px] animate-pulse rounded-lg bg-[var(--soft)]" />
      </main>
    </div>
  );
}
