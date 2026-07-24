/**
 * Squelette du PARRAINAGE — content-only (coque persistante).
 */
export default function ReferralLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-4 lg:px-6 lg:py-8">
      <div className="bg-surface-3 h-7 w-40 animate-pulse rounded-lg" />
      <div className="bg-surface-3 mt-4 h-52 w-full animate-pulse rounded-[20px]" />
      <div className="mt-3 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-20 animate-pulse rounded-[16px]"
          />
        ))}
      </div>
      <div className="bg-surface-3 mt-3 h-40 w-full animate-pulse rounded-[16px]" />
    </div>
  );
}
