"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =============================================================================
// Briques PARTAGÉES des inscriptions « étape par étape » (style Bolt Food) :
// commerçant, livreur, chauffeur. Le wizard appelant garde UN SEUL <form> dont
// les panneaux restent MONTÉS (l'inactif en `hidden`) — la soumission finale
// poste tous les champs d'un coup aux actions serveur existantes, zéro
// changement backend. Ici : style du fondu, tête d'étape (titre + compteur +
// barre segmentée), rangée Retour/Continuer, garde touche Entrée.
// =============================================================================

/** Fondu du panneau qui (ré)apparaît — à rendre UNE fois par wizard. La classe
 *  `swz-panel` rejoue l'animation à chaque activation (display:none la coupe). */
export function StepWizardStyle() {
  return (
    <style>{`@keyframes swzFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.swz-panel{animation:swzFade .18s ease}`}</style>
  );
}

/** Tête d'étape : titre + compteur (déjà localisé) + progression segmentée. */
export function StepWizardHeader({
  title,
  subtitle,
  stepLabel,
  step,
  total,
}: {
  title: string;
  subtitle: string;
  /** Ex. « Étape 2 sur 4 » — construit par l'appelant (FR/AR). */
  stepLabel: string;
  /** Étape active, 0-based. */
  step: number;
  total: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-subtle text-xs">{stepLabel}</p>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= step ? "bg-primary-600" : "bg-surface-3"
            )}
          />
        ))}
      </div>
      <p className="text-subtle text-xs">{subtitle}</p>
    </div>
  );
}

/** Rangée Retour / Continuer (ou soumission finale) + hint sous les boutons. */
export function StepWizardNav({
  step,
  isLast,
  canContinue,
  pending,
  onBack,
  onNext,
  labels,
  submitContent,
  submitDisabled = false,
  onSubmitClick,
  hint,
}: {
  step: number;
  isLast: boolean;
  /** L'étape active est complète (gate du bouton avancer/soumettre). */
  canContinue: boolean;
  pending: boolean;
  onBack: () => void;
  onNext: () => void;
  labels: { back: string; next: string };
  /** Contenu du bouton final (libellé + flèche, ou état « Création… »). */
  submitContent: ReactNode;
  /** Désactivation SUPPLÉMENTAIRE du submit (ex. session déjà active). */
  submitDisabled?: boolean;
  /** Ex. enregistrement du brouillon au moment de soumettre. */
  onSubmitClick?: () => void;
  /** Affiché sous les boutons tant que l'étape est incomplète. */
  hint?: string | null;
}) {
  return (
    <>
      <div className="flex gap-2 pt-1">
        {step > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={pending}
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {labels.back}
          </Button>
        )}
        {isLast ? (
          <Button
            type="submit"
            className="flex-1"
            disabled={pending || !canContinue || submitDisabled}
            onClick={onSubmitClick}
          >
            {submitContent}
          </Button>
        ) : (
          <Button
            type="button"
            className="flex-1"
            onClick={onNext}
            disabled={pending || !canContinue}
          >
            {labels.next}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Button>
        )}
      </div>
      {!canContinue && hint && (
        <p className="text-subtle text-center text-xs">{hint}</p>
      )}
    </>
  );
}

/**
 * Entrée = « Continuer » sur les étapes intermédiaires : jamais de soumission
 * implicite du formulaire complet par le navigateur avant la dernière étape.
 */
export function makeWizardKeyDown(
  isLast: boolean,
  goNext: () => void
): (e: KeyboardEvent<HTMLFormElement>) => void {
  return (e) => {
    if (e.key !== "Enter" || isLast) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLButtonElement)
      return;
    e.preventDefault();
    goNext();
  };
}
