// Skeleton instantané du hub Clients : l'écran apparaît au tap, les données
// se streament ensuite (règle perf CLAUDE.md).
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse p-4 lg:p-6">
      <div className="bg-surface-3 h-7 w-48 rounded-md" />
      <div className="bg-surface-2 mt-2 h-4 w-72 rounded" />
      <div className="bg-surface-2 mt-5 h-12 rounded-md" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface rounded-card-lg h-20 border"
          />
        ))}
      </div>
    </div>
  );
}
