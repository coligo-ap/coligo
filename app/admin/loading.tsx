// Filet de chargement générique pour toute page /admin qui `await` au serveur
// et n'a pas de loading.tsx plus proche → l'écran apparaît AU TAP (squelette),
// puis le contenu se streame. Conforme aux règles perf (CLAUDE.md).
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse p-4 lg:p-6">
      <div className="bg-surface-3 h-7 w-48 rounded-md" />
      <div className="bg-surface-2 mt-2 h-4 w-64 rounded" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface h-28 rounded-[16px] border"
          />
        ))}
      </div>
    </div>
  );
}
