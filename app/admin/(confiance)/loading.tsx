// Skeleton instantané du domaine Confiance (devices / reports / security) :
// la page s'affiche au tap, les données se streament ensuite (CLAUDE.md perf).
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl animate-pulse p-4 lg:p-6">
      <div className="bg-surface-3 h-7 w-56 rounded-md" />
      <div className="bg-surface-2 mt-2 h-4 w-72 rounded" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface rounded-card-lg h-24 border"
          />
        ))}
      </div>
    </div>
  );
}
