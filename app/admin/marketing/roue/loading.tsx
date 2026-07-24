/**
 * Squelette Marketing → Roue.
 */
export default function AdminWheelLoading() {
  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <div className="bg-surface-3 h-7 w-40 animate-pulse rounded-lg" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-20 animate-pulse rounded-[14px]"
          />
        ))}
      </div>
      <div className="bg-surface-3 mt-4 h-64 w-full animate-pulse rounded-[16px]" />
    </div>
  );
}
