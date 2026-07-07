/**
 * Squelette de /compte/supprimer — la page `await` (auth + soldes) au serveur,
 * la frontière rend l'écran instantané au tap (règle loading.tsx obligatoire).
 */
export default function DeleteAccountLoading() {
  return (
    <div className="bg-surface-2 min-h-screen">
      <div className="border-border sticky top-0 z-20 flex items-center gap-3 border-b bg-white px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <div className="bg-surface-2 size-9 rounded-full" />
        <div className="bg-surface-2 h-5 w-44 rounded" />
      </div>
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <div className="bg-danger-50 h-40 animate-pulse rounded-[16px]" />
        <div className="h-32 animate-pulse rounded-[16px] bg-white" />
      </div>
    </div>
  );
}
