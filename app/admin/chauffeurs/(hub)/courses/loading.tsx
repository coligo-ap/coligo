// Squelette de l'onglet Courses : apparition instantanée au tap (CLAUDE.md).
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="border-border bg-surface rounded-card-lg h-24 border" />
      <div className="border-border bg-surface rounded-card-lg h-32 border" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface rounded-card-lg h-20 border"
          />
        ))}
      </div>
    </div>
  );
}
