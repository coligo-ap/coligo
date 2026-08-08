"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { translateTextsAction } from "@/app/(merchant)/actions/translate";

/**
 * Bouton « Traduire en arabe » à poser à côté d'un champ *_ar.
 *
 * Deux modes :
 * - formulaire non contrôlé : `sourceField`/`targetField` = attributs `name`
 *   des champs du <form> englobant (lecture/écriture via form.elements) ;
 * - état contrôlé : `getSource()` fournit le texte FR, `onTranslated(value)`
 *   reçoit la traduction (ex. éditeur d'options).
 *
 * La traduction PRÉ-REMPLIT le champ : le commerçant relit et peut corriger
 * avant d'enregistrer. Erreurs affichées inline (règle produit : pas de toast).
 */
export function TranslateArButton({
  sourceField,
  targetField,
  getSource,
  onTranslated,
  disabled,
  compact,
  className,
}: {
  sourceField?: string;
  targetField?: string;
  getSource?: () => string;
  onTranslated?: (value: string) => void;
  disabled?: boolean;
  /** Icône seule (rangées denses, ex. éditeur d'options). */
  compact?: boolean;
  className?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function readField(name: string) {
    const el = btnRef.current?.form?.elements.namedItem(name);
    return el as HTMLInputElement | HTMLTextAreaElement | null;
  }

  async function handleClick() {
    setError(null);
    const source = (
      getSource
        ? getSource()
        : (sourceField && readField(sourceField)?.value) || ""
    ).trim();
    if (!source) {
      setError("Remplissez d'abord le champ français.");
      return;
    }
    setBusy(true);
    try {
      const res = await translateTextsAction([source]);
      const value = res.translations?.[0];
      if (!value) {
        setError(res.error ?? "Traduction indisponible.");
        return;
      }
      if (onTranslated) {
        onTranslated(value);
      } else if (targetField) {
        const target = readField(targetField);
        if (target) {
          // Setter natif + event « input » : met à jour la valeur même si un
          // composant React écoute le champ (pattern React pour champs non
          // contrôlés modifiés par programme).
          const proto =
            target instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(
            target,
            value
          );
          target.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(compact ? "shrink-0" : "", className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleClick}
        disabled={disabled || busy}
        title="Traduction automatique par IA depuis le français"
        className={cn(
          "border-border-strong text-primary-700 hover:bg-surface-2 rounded-control inline-flex items-center justify-center gap-1.5 border text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "size-8" : "h-8 px-2.5"
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        {!compact && (busy ? "Traduction…" : "Traduire en arabe")}
        {/* Pastille IA : assume la traduction par intelligence artificielle. */}
        {!compact && !busy && (
          <span className="bg-primary-600 text-nano rounded-full px-1.5 py-px leading-4 font-extrabold text-white">
            IA
          </span>
        )}
      </button>
      {error && <p className="text-danger-600 mt-1 text-xs">{error}</p>}
    </div>
  );
}
