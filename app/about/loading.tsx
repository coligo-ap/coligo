export default function Loading() {
  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="bg-surface h-4 w-20 animate-pulse rounded-full" />
        <div className="bg-surface mt-6 h-52 animate-pulse rounded-[24px]" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface aspect-[4/3] animate-pulse rounded-[16px]"
            />
          ))}
        </div>
        <div className="mt-8 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface h-24 animate-pulse rounded-[16px]"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
