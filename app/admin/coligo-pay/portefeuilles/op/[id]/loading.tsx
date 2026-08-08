// Squelette fiche portefeuille opérateur (règle loading.tsx, CLAUDE.md).
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="bg-surface-2 h-4 w-28 rounded" />
      <div className="bg-surface-3 mt-3 h-7 w-56 rounded-md" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="border-border bg-surface rounded-card-lg h-24 border" />
        <div className="border-border bg-surface rounded-card-lg h-24 border" />
      </div>
      <div className="border-border bg-surface rounded-card-lg mt-3 h-24 border" />
      <div className="border-border bg-surface rounded-card-lg mt-3 h-64 border" />
    </div>
  );
}
