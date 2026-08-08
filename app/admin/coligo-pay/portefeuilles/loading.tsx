// Squelette de l'onglet Portefeuilles (règle loading.tsx, CLAUDE.md).
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="bg-surface-2 h-4 w-80 rounded" />
      <div className="border-border bg-surface h-12 rounded-md border" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface rounded-card-lg h-16 border"
          />
        ))}
      </div>
    </div>
  );
}
