export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 lg:px-6">
      <div className="border-border h-28 animate-pulse rounded-2xl border bg-white" />
      <div className="border-border h-48 animate-pulse rounded-2xl border bg-white" />
      <div className="border-border h-64 animate-pulse rounded-2xl border bg-white" />
    </div>
  );
}
