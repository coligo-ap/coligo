// Squelette du parcours IDV chauffeur : l'écran apparaît au tap, les données
// (types de documents, dossier en cours) se streament ensuite (règle perf).
export default function Loading() {
  return (
    <div className="pt-safe mx-auto max-w-md animate-pulse px-5">
      <div
        className="h-6 w-48 rounded-md"
        style={{ background: "var(--d-soft)" }}
      />
      <div className="mt-6 space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-[88px] rounded-[16px]"
            style={{ background: "var(--d-soft)" }}
          />
        ))}
      </div>
      <div
        className="mt-6 h-12 rounded-full"
        style={{ background: "var(--d-soft)" }}
      />
    </div>
  );
}
