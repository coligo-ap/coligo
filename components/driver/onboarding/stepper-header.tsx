import { Check } from "lucide-react";
import { BRAND_GO, BRAND_VIOLET, SORA } from "@/components/shared/partner-ui";

export type StepperItem = {
  title: string;
  /** Toutes les exigences de l'étape sont satisfaites. */
  complete: boolean;
};

/**
 * Fil d'Ariane du parcours d'inscription livreur.
 *
 * Il répond aux trois questions que se pose quelqu'un au milieu d'un formulaire
 * long : où suis-je, qu'ai-je terminé, que reste-t-il. Une étape déjà validée
 * reste CLIQUABLE — revenir corriger une information ne doit pas obliger à tout
 * refaire ; une étape jamais atteinte ne l'est pas.
 */
export function StepperHeader({
  steps,
  current,
  onGo,
}: {
  steps: StepperItem[];
  /** Index de l'étape affichée (0-based). */
  current: number;
  onGo: (index: number) => void;
}) {
  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-baseline justify-between">
        <b
          className="text-[13px] font-bold text-[var(--ink)]"
          style={{ fontFamily: SORA }}
        >
          Étape {current + 1}/{steps.length}
        </b>
        <span className="text-[12.5px] font-semibold text-[var(--muted)]">
          {steps[current]?.title}
        </span>
      </div>

      <ol className="mt-3 flex items-center gap-1.5">
        {steps.map((s, i) => {
          const reachable = i <= current || steps[i - 1]?.complete === true;
          const state =
            i === current ? "current" : s.complete ? "done" : "todo";
          return (
            <li key={s.title} className="flex flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={() => reachable && onGo(i)}
                disabled={!reachable}
                aria-current={i === current ? "step" : undefined}
                aria-label={`Étape ${i + 1} : ${s.title}`}
                className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-extrabold tabular-nums transition disabled:cursor-not-allowed"
                style={
                  state === "done"
                    ? { background: BRAND_GO, color: "#fff" }
                    : state === "current"
                      ? {
                          background: "var(--violet-soft)",
                          color: BRAND_VIOLET,
                          border: `2px solid ${BRAND_VIOLET}`,
                        }
                      : { background: "var(--soft)", color: "var(--muted)" }
                }
              >
                {state === "done" ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  i + 1
                )}
              </button>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className="h-[2px] flex-1 rounded-full"
                  style={{
                    background: s.complete ? BRAND_GO : "var(--line)",
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
