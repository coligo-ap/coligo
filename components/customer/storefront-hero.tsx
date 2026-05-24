import { Sparkles } from "lucide-react";

// =============================================================================
// StorefrontHero — bandeau d'accueil compact sur la home.
// =============================================================================
// On évite le doublon avec le header sticky (qui montre déjà la wilaya +
// commune cliquable + cart + compte). Le hero se concentre sur la salutation
// chaleureuse, sans contrôle interactif (la localisation reste dans le header
// global, accessible partout).
//
// Hauteur réduite pour ne pas pousser la liste des commerces trop bas dans le
// viewport — le client doit voir les commerces sans trop scroller.
// =============================================================================

type Props = {
  /** Prénom du client connecté pour le bonjour personnalisé (optionnel). */
  firstName?: string | null;
};

export function StorefrontHero({ firstName }: Props) {
  const greeting = firstName
    ? `Salut ${firstName} 👋`
    : "Qu'est-ce qu'on commande ?";

  return (
    <section className="from-primary-700 via-primary-600 to-primary-500 -mx-4 -mt-4 rounded-b-[24px] bg-gradient-to-br px-4 pt-5 pb-6 text-white shadow-sm lg:-mx-6 lg:-mt-8 lg:px-6 lg:pt-7 lg:pb-7">
      <div className="mx-auto max-w-[1400px]">
        <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-white/80 uppercase">
          <Sparkles className="size-3.5" />
          Coligo · Click & Collect
        </p>
        <h1 className="font-display mt-2 text-2xl leading-tight font-bold lg:text-3xl">
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-white/85">
          Commande dans tes commerces de quartier, retire sans faire la queue.
        </p>
      </div>
    </section>
  );
}
