export default function Loading() {
  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="bg-surface h-4 w-28 animate-pulse rounded-full" />
        <div className="bg-surface mt-6 h-4 w-40 animate-pulse rounded-full" />
        <div className="bg-surface mt-4 h-8 w-full animate-pulse rounded-full" />
        <div className="bg-surface mt-2 h-8 w-2/3 animate-pulse rounded-full" />
        <div className="bg-surface mt-6 aspect-[21/9] animate-pulse rounded-[20px]" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface h-4 w-full animate-pulse rounded-full"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
