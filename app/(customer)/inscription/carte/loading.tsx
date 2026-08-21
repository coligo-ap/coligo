export default function Loading() {
  return (
    <div className="mx-auto max-w-md px-4 pt-[calc(env(safe-area-inset-top)+3rem)]">
      <div className="bg-surface-3 h-8 w-3/4 animate-pulse rounded-md" />
      <div className="bg-surface-3 mt-3 h-4 w-full animate-pulse rounded-md" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface-3 h-14 animate-pulse rounded-md" />
        ))}
      </div>
    </div>
  );
}
