import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

/**
 * Squelette dédié à /compte (page `noHeader` : pas de header sticky, hero violet
 * plein cadre). Frontière propre au segment pour que le prefetch du `<Link>`
 * « Compte » soit réellement instantané et que le squelette épouse la VRAIE
 * forme de la page (hero + cartes soldes qui chevauchent + listes) au lieu du
 * squelette « marketplace » générique du groupe.
 */
export default function AccountLoading() {
  return (
    <div data-space="client" className="bg-surface-2 min-h-screen">
      <main className="pb-20 lg:pb-0">
        <div className="mx-auto max-w-2xl pb-24">
          {/* Hero violet (placeholder, hauteur du hero profil). */}
          <div className="from-primary-400 via-primary-600 to-primary-800 bg-gradient-to-br px-5 pt-[calc(env(safe-area-inset-top)+1.75rem)] pb-16">
            <div className="h-3 w-24 rounded bg-white/30" />
            <div className="mt-5 flex items-center gap-3.5">
              <div className="size-16 shrink-0 rounded-2xl bg-white/25" />
              <div className="space-y-2">
                <div className="h-5 w-40 rounded bg-white/30" />
                <div className="h-3 w-24 rounded bg-white/20" />
              </div>
            </div>
          </div>

          {/* Cartes soldes qui chevauchent le bas du hero. */}
          <div className="relative z-10 -mt-11 grid grid-cols-2 gap-3 px-4">
            <div className="bg-surface-3 h-24 animate-pulse rounded-[18px]" />
            <div className="bg-surface-3 h-24 animate-pulse rounded-[18px]" />
          </div>

          {/* Sections de menu (Compte / Activité / Aide). */}
          <div className="mt-6 space-y-5 px-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-3 h-20 animate-pulse rounded-[20px]"
              />
            ))}
          </div>
        </div>
      </main>
      <CustomerBottomNav hiddenKeys={[]} />
    </div>
  );
}
