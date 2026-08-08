export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 lg:p-6">
      <div className="bg-surface-2 rounded-control h-8 w-64 animate-pulse" />
      <div className="bg-surface-2 h-40 animate-pulse rounded-lg" />
      <div className="bg-surface-2 h-64 animate-pulse rounded-lg" />
      <div className="bg-surface-2 h-52 animate-pulse rounded-lg" />
    </div>
  );
}
