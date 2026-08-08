export default function Loading() {
  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="bg-surface h-4 w-20 animate-pulse rounded-full" />
        <div className="bg-surface mt-6 h-7 w-48 animate-pulse rounded-full" />
        <div className="bg-surface mt-6 h-72 animate-pulse rounded-xl" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-sheet-lg h-56 animate-pulse"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
