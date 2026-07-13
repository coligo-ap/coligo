// Squelette de la file de revue : l'écran s'affiche au tap, les dossiers se
// streament ensuite (règle perf du projet).
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse space-y-4 px-4 py-5 lg:px-6">
      <div className="bg-surface-3 h-6 w-48 rounded-md" />
      <div className="bg-surface-2 h-4 w-64 rounded" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface h-[86px] rounded-[16px] border"
          />
        ))}
      </div>
    </div>
  );
}
