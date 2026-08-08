/**
 * Frontières de chargement des écrans qui n'appartiennent à AUCUN espace :
 * authentification et téléchargement de l'application. Leurs pages partagent un
 * châssis commun (`auth-screen.tsx`, `app-download-page.tsx`), leurs squelettes
 * le partagent donc aussi — un portail ne peut plus dessiner une barre de
 * navigation du bas qu'il n'a pas, ni faire apparaître son panneau marketing
 * après coup.
 *
 * Aucune donnée n'est lue ici → rendu immédiat au tap, le contenu se streame
 * derrière.
 */
function Bar({ className = "" }: { className?: string }) {
  return (
    <span
      className={`bg-surface-3 block animate-pulse rounded-lg ${className}`}
    />
  );
}

export function AuthPageSkeleton() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Bandeau */}
      <div className="border-border flex h-16 items-center justify-between border-b px-4 lg:px-8">
        <Bar className="h-8 w-28" />
        <Bar className="h-8 w-24" />
      </div>

      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-5">
        {/* Panneau marketing — desktop uniquement, comme dans AuthScreen. */}
        <aside className="from-primary-500 via-primary-600 to-primary-800 hidden flex-col justify-between bg-gradient-to-br p-12 lg:col-span-2 lg:flex">
          <div className="space-y-4">
            <Bar className="h-10 w-3/4 !bg-white/25" />
            <Bar className="h-5 w-2/3 !bg-white/20" />
            <div className="space-y-3 pt-6">
              <Bar className="h-4 w-1/2 !bg-white/20" />
              <Bar className="h-4 w-2/5 !bg-white/20" />
              <Bar className="h-4 w-1/2 !bg-white/20" />
            </div>
          </div>
          <Bar className="h-3 w-40 !bg-white/15" />
        </aside>

        {/* Carte de formulaire */}
        <main className="bg-surface-2 flex items-center justify-center p-4 py-8 lg:col-span-3 lg:bg-white lg:p-12">
          <div className="w-full max-w-md">
            <div className="mb-8 flex justify-center lg:hidden">
              <Bar className="h-10 w-32" />
            </div>
            <div className="border-border rounded-card-lg border bg-white p-6 shadow-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
              <Bar className="mb-2 h-8 w-56" />
              <Bar className="mb-6 h-4 w-64" />
              <div className="space-y-3">
                <Bar className="h-12 w-full !rounded-md" />
                <Bar className="h-12 w-full !rounded-md" />
                <Bar className="h-12 w-full !rounded-md" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Carte centrée sur fond `bg-surface-2` — la forme partagée des écrans d'auth
 * secondaires (mot de passe oublié, réinitialisation, challenge 2FA). Ils sont
 * en `force-dynamic` : sans frontière, le tap laisse un écran blanc le temps de
 * l'aller-retour serveur. Titre + sous-titre + trois champs, comme les formulaires
 * qu'elle remplace.
 */
export function CenteredCardSkeleton() {
  return (
    <div className="bg-surface-2 flex min-h-screen items-center justify-center p-4">
      <div className="border-border w-full max-w-md rounded-lg border bg-white p-6 shadow-sm">
        <Bar className="mb-2 h-7 w-52" />
        <Bar className="mb-6 h-4 w-full max-w-[18rem]" />
        <div className="space-y-3">
          <Bar className="h-12 w-full !rounded-md" />
          <Bar className="h-12 w-full !rounded-md" />
          <Bar className="h-11 w-full !rounded-md" />
        </div>
      </div>
    </div>
  );
}

/**
 * Page de téléchargement de l'APK (`AppDownloadPage`) : lien de retour, en-tête
 * avec icône, puis la liste des avantages. Pas de châssis d'espace.
 */
export function DownloadPageSkeleton() {
  return (
    <div className="mx-auto max-w-[820px] p-4 lg:p-6 lg:px-8">
      <Bar className="mb-3 h-5 w-20" />
      <div className="border-border rounded-lg border p-6">
        <div className="flex items-center gap-4">
          <Bar className="!rounded-sheet-lg size-16" />
          <div className="flex-1 space-y-2">
            <Bar className="h-6 w-48" />
            <Bar className="h-4 w-64" />
          </div>
        </div>
        <Bar className="mt-6 h-12 w-full !rounded-md" />
        <div className="mt-6 space-y-3">
          <Bar className="h-4 w-3/4" />
          <Bar className="h-4 w-2/3" />
          <Bar className="h-4 w-3/5" />
        </div>
      </div>
    </div>
  );
}
