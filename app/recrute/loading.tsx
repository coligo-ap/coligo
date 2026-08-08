// Squelette /recrute — la page lit les drapeaux recruit_* au serveur : la
// frontière rend l'écran instantané au tap, le contenu se streame derrière.
export default function RecruteLoading() {
  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-3xl animate-pulse px-4 py-10">
        <div className="bg-surface h-4 w-16 rounded-sm" />
        <div className="cg-brand-gradient mt-6 h-64 rounded-lg opacity-60" />
        <div className="bg-surface mt-8 h-5 w-48 rounded-sm" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-border bg-surface rounded-card-lg h-80 overflow-hidden border"
            >
              <div className="bg-surface-2 h-36 w-full" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
