export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 lg:px-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="border-border h-20 animate-pulse rounded-2xl border bg-white"
          />
        ))}
      </div>
      <div className="border-border h-56 animate-pulse rounded-2xl border bg-white" />
      <div className="border-border h-72 animate-pulse rounded-2xl border bg-white" />
    </div>
  );
}
