// Squelette de la fiche client (affichage au tap, données streamées ensuite).
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse p-4 lg:p-6">
      <div className="bg-surface-2 h-4 w-32 rounded" />
      <div className="bg-surface-3 mt-3 h-8 w-64 rounded-md" />
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface rounded-card-lg h-20 border"
          />
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface h-40 rounded-lg border"
          />
        ))}
      </div>
    </div>
  );
}
