export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-3 px-4 py-5 lg:px-6">
      <div className="bg-surface-2 h-10 w-64 animate-pulse rounded-[12px]" />
      <div className="bg-surface-2 h-40 animate-pulse rounded-[14px]" />
      <div className="bg-surface-2 h-64 animate-pulse rounded-[14px]" />
    </div>
  );
}
