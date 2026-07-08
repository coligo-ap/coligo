// Squelette fiche portefeuille client (règle loading.tsx, CLAUDE.md).
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="bg-surface-2 h-4 w-28 rounded" />
      <div className="bg-surface-3 mt-3 h-7 w-56 rounded-md" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="border-border bg-surface h-24 rounded-[14px] border" />
        <div className="border-border bg-surface h-24 rounded-[14px] border" />
      </div>
      <div className="border-border bg-surface mt-3 h-24 rounded-[14px] border" />
      <div className="border-border bg-surface mt-3 h-64 rounded-[14px] border" />
    </div>
  );
}
