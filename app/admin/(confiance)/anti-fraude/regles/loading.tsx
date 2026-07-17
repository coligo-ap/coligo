export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-3 px-4 py-5 lg:px-6">
      <div className="border-border h-10 w-1/2 animate-pulse rounded-xl border bg-white" />
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="border-border h-40 animate-pulse rounded-2xl border bg-white"
        />
      ))}
    </div>
  );
}
