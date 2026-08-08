/**
 * Squelette Marketing → Annonces.
 */
export default function AdminAnnouncementsLoading() {
  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <div className="bg-surface-3 h-7 w-40 animate-pulse rounded-lg" />
      <div className="bg-surface-3 rounded-card mt-5 h-10 w-64 animate-pulse" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface-3 h-20 animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}
