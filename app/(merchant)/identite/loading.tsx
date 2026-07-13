// Squelette du parcours IDV commerçant : l'écran apparaît au tap, les données
// se streament ensuite (règle perf du projet).
export default function Loading() {
  return (
    <div className="mx-auto max-w-md animate-pulse px-4 py-6">
      <div className="bg-surface-2 h-5 w-40 rounded" />
      <div className="bg-surface-3 mt-3 h-7 w-56 rounded-md" />
      <div className="mt-6 space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface-2 h-[88px] rounded-[16px]" />
        ))}
      </div>
      <div className="bg-surface-2 mt-6 h-12 rounded-full" />
    </div>
  );
}
