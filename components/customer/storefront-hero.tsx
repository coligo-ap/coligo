"use client";

import { Sparkles } from "lucide-react";

// =============================================================================
// StorefrontHero — bandeau violet de bienvenue (home uniquement).
// =============================================================================
// La navigation (logo + localisation + panier + compte) est désormais portée
// par le CustomerHeader sticky du shell, comme sur le reste du site. Le hero
// ne contient plus QUE la salutation + le tagline — il défile normalement
// avec le contenu, le header sticky reprend la main au scroll.
// =============================================================================

type Props = {
  firstName?: string | null;
};

export function StorefrontHero({ firstName }: Props) {
  const greeting = firstName
    ? `Salut ${firstName} 👋`
    : "Qu'est-ce qu'on commande ?";

  return (
    <section className="from-primary-700 via-primary-600 to-primary-500 relative -mx-4 -mt-4 overflow-hidden rounded-b-[28px] bg-gradient-to-br px-4 pt-5 pb-6 text-white shadow-md lg:-mx-6 lg:-mt-8 lg:px-6 lg:pt-7 lg:pb-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 90% 10%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%), radial-gradient(45% 35% at 10% 100%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 70%)",
        }}
      />

      <div className="relative mx-auto max-w-[1400px]">
        <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-white/80 uppercase">
          <Sparkles className="size-3.5" />
          Coligo · Click & Collect
        </p>
        <h1 className="font-display mt-1 text-2xl leading-tight font-bold lg:text-3xl">
          {greeting}
        </h1>
        <p className="mt-1 max-w-md text-sm text-white/85">
          Commande dans tes commerces de quartier, retire sans faire la queue.
        </p>
      </div>
    </section>
  );
}
