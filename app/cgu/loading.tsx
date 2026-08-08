export default function Loading() {
  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="bg-surface h-4 w-20 animate-pulse rounded-full" />
        <div className="bg-surface mt-6 h-7 w-2/3 animate-pulse rounded-full" />
        <div className="mt-8 space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-surface h-20 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    </main>
  );
}
