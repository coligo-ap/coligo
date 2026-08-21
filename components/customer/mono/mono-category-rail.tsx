// =============================================================================
// MonoCategoryRail — rail de catégories du thème « bold minimalism ».
//
// Images DÉTOURÉES posées directement sur le fond de page : ni carte, ni rond,
// ni ombre derrière. L'objet flotte, le libellé se lit dessous.
//
// Affordance de défilement : le conteneur déborde des gouttières (-mx-4) et n'a
// PAS de marge de fin — le dernier objet est donc coupé par le bord, ce qui
// signale qu'il y a une suite. Accroche douce (scroll-snap proximity) et
// scrollbar masquée : voir la classe `.mono-rail` (app/theme-mono.css).
// =============================================================================

export type MonoCategory = {
  code: string;
  label: string;
  /** Illustration détourée (fond transparent). */
  image: string;
};

export function MonoCategoryRail({ items }: { items: MonoCategory[] }) {
  return (
    <div className="mono-rail -mx-4 flex gap-6 overflow-x-auto ps-4">
      {items.map((c) => (
        <button
          key={c.code}
          type="button"
          className="flex w-[104px] shrink-0 flex-col items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={c.image}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="h-[110px] w-full object-contain"
          />
          <span className="text-title-lg text-center leading-tight font-medium text-[var(--ink)]">
            {c.label}
          </span>
        </button>
      ))}
    </div>
  );
}
