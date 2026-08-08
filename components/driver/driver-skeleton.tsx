import { DriverBottomNav } from "./driver-bottom-nav";

/**
 * Squelettes de chargement du livreur (frontières `loading.tsx`), sur le modèle
 * de `components/chauffeur/d-skeleton.tsx`.
 *
 * Pourquoi un squelette PAR FORME de page et pas un seul générique : la
 * frontière la plus proche est celle qui s'affiche au tap. Un squelette qui ne
 * ressemble pas à la page qu'il annonce produit un saut visuel au moment où le
 * contenu réel arrive — une barre du bas sur un écran de connexion qui n'en a
 * pas, un en-tête de retour qui apparaît après coup. Chaque `loading.tsx` du
 * livreur ré-exporte donc la forme qui correspond à sa page.
 *
 * Aucune donnée n'est lue ici → rendu immédiat, jamais bloquant.
 */

function Bar({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block animate-pulse rounded-sm bg-[var(--soft)] ${className}`}
    />
  );
}

/** Chrome commun aux pages internes : mêmes paddings que `DriverShell`. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-surface)]">
      <main className="pt-safe pb-safe-nav mx-auto max-w-md px-5">
        <div className="space-y-4 pt-1">{children}</div>
      </main>
      <DriverBottomNav />
    </div>
  );
}

/** En-tête « titre + action » des pages d'onglet. */
function TitleRow() {
  return (
    <div className="flex items-center justify-between">
      <Bar className="h-7 w-36 !rounded-lg" />
      <Bar className="!rounded-card size-10" />
    </div>
  );
}

/**
 * Page d'onglet (accueil, historique, relevé, tournées, paramètres, course) :
 * titre, carte principale, tuiles, lignes de liste.
 */
export function PageSkeleton() {
  return (
    <Shell>
      <TitleRow />
      <Bar className="!rounded-sheet-lg h-28 w-full" />
      <div className="grid grid-cols-3 gap-2">
        <Bar className="!rounded-card-lg h-20" />
        <Bar className="!rounded-card-lg h-20" />
        <Bar className="!rounded-card-lg h-20" />
      </div>
      <Bar className="!rounded-card-lg h-16 w-full" />
      <Bar className="!rounded-card-lg h-16 w-full" />
      <Bar className="!rounded-card-lg h-16 w-full" />
    </Shell>
  );
}

/**
 * ACCUEIL (carte plein écran + barre « en ligne » dockée + barre du bas).
 * NE PAS réutiliser `PageSkeleton` ici : l'accueil n'a NI titre NI tuiles NI
 * liste — c'est une carte. Un squelette liste par-dessus la carte persistante
 * (montée dans le layout) produisait un saut visuel violent à l'arrivée du
 * contenu réel (signalé par le user : « le loading ne correspond pas »).
 *
 * Ici, on ne COUVRE PAS la carte : elle est déjà montée dans le layout
 * (`PersistentDriverMap`, persiste entre onglets) et reste visible DERRIÈRE.
 * On rend juste — en fragment transparent — le skeleton de la SEULE barre
 * « en ligne » à sa position réelle (`above-nav`) et la barre du bas conservée.
 * Résultat : la carte est là instantanément, seul l'overlay maquette se streame.
 */
export function HomeSkeleton() {
  return (
    <>
      <div className="above-nav fixed inset-x-3 z-[46] mx-auto max-w-md">
        <div className="flex items-center gap-3 rounded-xl border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5 shadow-xl">
          <span className="size-11 shrink-0 animate-pulse rounded-full bg-[var(--d-soft)]" />
          <div className="flex-1 space-y-1.5">
            <span className="block h-4 w-24 animate-pulse rounded bg-[var(--d-soft)]" />
            <span className="block h-3 w-40 animate-pulse rounded bg-[var(--d-soft)]" />
          </div>
          <span className="h-[30px] w-[52px] shrink-0 animate-pulse rounded-full bg-[var(--d-soft)]" />
        </div>
      </div>
      <DriverBottomNav />
    </>
  );
}

/**
 * Pages d'argent (gains, recharger) : la barre d'onglets `MoneyTabs` puis un
 * grand total, puis deux tuiles. Reprend la forme du squelette client de
 * `gains-loader.tsx` pour qu'aucun saut ne se produise entre les deux.
 */
export function MoneyPageSkeleton() {
  return (
    <Shell>
      <TitleRow />
      <Bar className="!rounded-card-lg h-10 w-full" />
      <Bar className="h-44 w-full !rounded-xl" />
      <div className="grid grid-cols-2 gap-2.5">
        <Bar className="h-20 !rounded-lg" />
        <Bar className="h-20 !rounded-lg" />
      </div>
    </Shell>
  );
}

/**
 * Sous-pages ouvertes depuis une autre page (abonnement, codes, documents,
 * espace commerçant, tournées) : elles portent un `PartnerBackHeader`, que le
 * squelette doit annoncer sous peine de voir la flèche de retour apparaître
 * après coup.
 */
export function BackPageSkeleton() {
  return (
    <Shell>
      <div className="flex items-center gap-3">
        <Bar className="!rounded-card size-10" />
        <Bar className="h-6 w-40 !rounded-lg" />
      </div>
      <Bar className="!rounded-sheet-lg h-24 w-full" />
      <Bar className="!rounded-card-lg h-16 w-full" />
      <Bar className="!rounded-card-lg h-16 w-full" />
      <Bar className="!rounded-card-lg h-16 w-full" />
    </Shell>
  );
}
