export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 lg:p-6">
      <div className="bg-surface-2 h-8 w-64 animate-pulse rounded-[10px]" />
      <div className="bg-surface-2 h-40 animate-pulse rounded-[16px]" />
      <div className="bg-surface-2 h-64 animate-pulse rounded-[16px]" />
      <div className="bg-surface-2 h-52 animate-pulse rounded-[16px]" />
    </div>
  );
}
