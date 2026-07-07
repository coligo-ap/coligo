// Squelette de la recherche de commandes : l'écran apparaît AU TAP, la liste
// se streame ensuite (règle loading.tsx obligatoire, CLAUDE.md).
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl animate-pulse p-4 lg:p-6">
      <div className="bg-surface-3 h-7 w-44 rounded-md" />
      <div className="bg-surface-2 mt-2 h-4 w-72 rounded" />
      <div className="border-border bg-surface mt-4 h-36 rounded-[14px] border" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface h-20 rounded-[14px] border"
          />
        ))}
      </div>
    </div>
  );
}
