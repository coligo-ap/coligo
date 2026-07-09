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
      className={`block animate-pulse rounded-[8px] bg-[var(--soft)] ${className}`}
    />
  );
}

/** Chrome commun aux pages internes : mêmes paddings que `DriverShell`. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[var(--d-surface)]">
      <main className="mx-auto max-w-md px-5 pt-4 pb-24">
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
      <Bar className="size-10 !rounded-[13px]" />
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
      <Bar className="h-28 w-full !rounded-[18px]" />
      <div className="grid grid-cols-3 gap-2">
        <Bar className="h-20 !rounded-[14px]" />
        <Bar className="h-20 !rounded-[14px]" />
        <Bar className="h-20 !rounded-[14px]" />
      </div>
      <Bar className="h-16 w-full !rounded-[14px]" />
      <Bar className="h-16 w-full !rounded-[14px]" />
      <Bar className="h-16 w-full !rounded-[14px]" />
    </Shell>
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
      <Bar className="h-10 w-full !rounded-[14px]" />
      <Bar className="h-44 w-full !rounded-[20px]" />
      <div className="grid grid-cols-2 gap-2.5">
        <Bar className="h-20 !rounded-[16px]" />
        <Bar className="h-20 !rounded-[16px]" />
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
        <Bar className="size-10 !rounded-[13px]" />
        <Bar className="h-6 w-40 !rounded-lg" />
      </div>
      <Bar className="h-24 w-full !rounded-[18px]" />
      <Bar className="h-16 w-full !rounded-[14px]" />
      <Bar className="h-16 w-full !rounded-[14px]" />
      <Bar className="h-16 w-full !rounded-[14px]" />
    </Shell>
  );
}

/**
 * Écrans hors application (connexion, création de compte, téléchargement) :
 * PAS de barre du bas — l'utilisateur n'est pas encore dans l'espace livreur.
 * C'est le seul squelette qui ne reprend pas le chrome de `DriverShell`.
 */
export function AuthPageSkeleton() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--d-surface)]">
      <div className="border-b border-[var(--d-line)] px-5 py-4">
        <Bar className="h-8 w-28 !rounded-lg" />
      </div>
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm space-y-4">
          <Bar className="h-7 w-48 !rounded-lg" />
          <Bar className="h-4 w-64 !rounded" />
          <Bar className="mt-6 h-12 w-full !rounded-[14px]" />
          <Bar className="h-12 w-full !rounded-[14px]" />
          <Bar className="h-12 w-full !rounded-[14px]" />
        </div>
      </div>
    </div>
  );
}
