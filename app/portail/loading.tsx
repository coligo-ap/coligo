/**
 * Frontière de chargement du portail super-admin (`force-dynamic`). Reprend le
 * thème sombre slate de la page pour éviter un flash blanc au tap : pastille
 * bouclier + titre + deux champs + bouton, en tons ardoise.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-4 block size-14 animate-pulse rounded-2xl bg-slate-800" />
          <span className="block h-6 w-44 animate-pulse rounded-lg bg-slate-800" />
          <span className="mt-2 block h-4 w-56 animate-pulse rounded-lg bg-slate-800/70" />
        </div>
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <span className="block h-11 w-full animate-pulse rounded-md bg-slate-800" />
          <span className="block h-11 w-full animate-pulse rounded-md bg-slate-800" />
          <span className="bg-primary-600/40 block h-11 w-full animate-pulse rounded-md" />
        </div>
      </div>
    </div>
  );
}
