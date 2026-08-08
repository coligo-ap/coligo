export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-3 px-4 py-5 lg:px-6">
      <div className="bg-surface-2 h-10 w-64 animate-pulse rounded-md" />
      <div className="bg-surface-2 rounded-card-lg h-40 animate-pulse" />
      <div className="bg-surface-2 rounded-card-lg h-64 animate-pulse" />
    </div>
  );
}
