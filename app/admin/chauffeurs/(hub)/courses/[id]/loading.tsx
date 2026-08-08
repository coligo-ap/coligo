// Squelette de la fiche course : apparition instantanée au tap (CLAUDE.md).
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="bg-surface-2 h-4 w-24 rounded" />
      <div className="bg-surface-3 mt-3 h-7 w-64 rounded-md" />
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface rounded-card-lg h-28 border"
          />
        ))}
      </div>
      <div className="border-border bg-surface rounded-card-lg mt-3 h-44 border" />
      <div className="border-border bg-surface rounded-card-lg mt-3 h-56 border" />
    </div>
  );
}
