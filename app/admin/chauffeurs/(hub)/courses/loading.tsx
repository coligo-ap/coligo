// Squelette de l'onglet Courses : apparition instantanée au tap (CLAUDE.md).
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="border-border bg-surface h-24 rounded-[14px] border" />
      <div className="border-border bg-surface h-32 rounded-[14px] border" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface h-20 rounded-[14px] border"
          />
        ))}
      </div>
    </div>
  );
}
