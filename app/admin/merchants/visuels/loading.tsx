export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="bg-surface h-20 animate-pulse rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="bg-surface h-72 animate-pulse rounded-lg" />
        <div className="space-y-3">
          <div className="bg-surface h-40 animate-pulse rounded-lg" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface h-24 animate-pulse rounded-md"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
