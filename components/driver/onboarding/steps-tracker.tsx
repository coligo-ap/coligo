import { Check, Clock, Lock } from "lucide-react";
import { BRAND_GO, BRAND_VIOLET, SORA } from "@/components/shared/partner-ui";

export type StepState = "done" | "current" | "todo";

export type TrackerStep = {
  title: string;
  sub: string;
  state: StepState;
};

/**
 * Suivi visuel des étapes de l'inscription livreur (compte créé → documents
 * transmis → vérification → validation par l'équipe Coligo → compte activé).
 *
 * C'est la SEULE représentation textuelle de l'état d'avancement de l'écran
 * d'attente : le titre de la page dit « en cours de vérification », le tracker
 * le montre sous une autre forme (cf. règle anti-doublon d'information).
 */
export function StepsTracker({ steps }: { steps: TrackerStep[] }) {
  return (
    <ol className="mx-auto max-w-[340px]">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className="grid size-[28px] shrink-0 place-items-center rounded-full"
              style={
                s.state === "done"
                  ? { background: BRAND_GO, color: "#fff" }
                  : s.state === "current"
                    ? {
                        background: "var(--violet-soft)",
                        color: BRAND_VIOLET,
                        border: `2px solid ${BRAND_VIOLET}`,
                      }
                    : { background: "var(--soft)", color: "var(--muted)" }
              }
            >
              {s.state === "done" ? (
                <Check className="size-3.5" strokeWidth={3} />
              ) : s.state === "current" ? (
                <Clock className="size-3.5" />
              ) : (
                <Lock className="size-3" />
              )}
            </span>
            {i < steps.length - 1 && (
              <span className="min-h-[20px] w-[2px] flex-1 bg-[var(--line)]" />
            )}
          </div>
          <div className="pb-5 text-start">
            <b
              className="block text-[13.5px] font-bold text-[var(--ink)]"
              style={{ fontFamily: SORA }}
            >
              {s.title}
            </b>
            <small className="mt-0.5 block text-[11.5px] font-medium text-[var(--muted)]">
              {s.sub}
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}
