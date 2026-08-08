// Squelette de la fiche commande : apparition instantanée au tap, sections
// streamées ensuite (règle loading.tsx obligatoire, CLAUDE.md).
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl animate-pulse p-4 lg:p-6">
      <div className="bg-surface-2 h-4 w-32 rounded" />
      <div className="bg-surface-3 mt-3 h-7 w-56 rounded-md" />
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface rounded-card-lg h-28 border"
          />
        ))}
      </div>
      <div className="border-border bg-surface rounded-card-lg mt-4 h-48 border" />
      <div className="border-border bg-surface rounded-card-lg mt-4 h-64 border" />
    </div>
  );
}
