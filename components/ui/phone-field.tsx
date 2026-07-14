"use client";

import { useId, useState } from "react";
import { useLocale } from "next-intl";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COUNTRY_CODES,
  composePhone,
  formatNational,
  phoneErrorFor,
  splitPhone,
} from "@/lib/dz/phone";

/**
 * LE champ téléphone de l'application. Aucun écran ne doit plus poser un
 * `<input type="tel">` nu.
 *
 * Il émet, dans un champ caché, la valeur CANONIQUE produite par
 * `composePhone()` : `0XXXXXXXXX` pour l'Algérie, `+CC…` (E.164) ailleurs. C'est
 * la même valeur que celle déjà stockée en base et que celle dont dérive l'email
 * synthétique d'authentification (`<chiffres>@drivers.coligo.local`).
 *
 * Pourquoi ça compte : tant que chaque écran normalisait le numéro à sa façon,
 * « 0603044620 » et « +213603044620 » — le même livreur — produisaient deux
 * emails synthétiques différents, donc DEUX COMPTES. Ici la saisie converge :
 * avec ou sans zéro initial, avec ou sans indicatif, on obtient une seule
 * valeur.
 *
 * Tant que le numéro est invalide, le champ caché est VIDE : le serveur rejette
 * la soumission plutôt que de créer un compte sur une valeur ambiguë.
 */
export function PhoneField({
  name = "phone",
  label,
  defaultValue,
  required = false,
  disabled = false,
  autoFocus = false,
  error,
  hint,
  className,
  onValueChange,
  onEnter,
  variant = "boxed",
}: {
  name?: string;
  label?: string | null;
  /** Valeur stockée (`0XXXXXXXXX` ou `+CC…`) : le champ se ré-alimente seul. */
  defaultValue?: string | null;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Erreur venue du serveur — prioritaire sur la validation locale. */
  error?: string | null;
  /** Aide affichée tant qu'aucune erreur n'est montrée. */
  hint?: string;
  className?: string;
  /**
   * Reçoit la valeur canonique (`null` tant qu'elle est invalide) et la saisie
   * brute. Un appelant qui doit distinguer « champ vide » de « numéro en cours
   * de frappe » regarde `raw` : sans lui, une saisie incomplète serait
   * indiscernable d'une absence de saisie.
   */
  onValueChange?: (canonical: string | null, raw: string) => void;
  /** Validation au clavier quand le champ n'est pas dans un `<form>`. */
  onEnter?: () => void;
  /**
   * `"boxed"` (défaut) dessine libellé, cadre et message. `"bare"` ne rend que
   * l'indicatif et la saisie : à utiliser quand l'écran fournit déjà sa propre
   * ligne de formulaire, pour ne pas empiler deux bordures.
   */
  variant?: "boxed" | "bare";
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  // `undefined` = libellé par défaut bilingue ; `null` = pas de libellé du tout.
  const shownLabel =
    label === undefined ? (isAr ? "الهاتف" : "Téléphone") : label;
  const initial = splitPhone(defaultValue);
  const [dial, setDial] = useState(initial.dial);
  const [national, setNational] = useState(() =>
    formatNational(initial.dial, initial.national)
  );
  // On n'accuse pas l'utilisateur d'une erreur avant qu'il ait fini de saisir.
  const [touched, setTouched] = useState(false);
  const fieldId = useId();

  const canonical = composePhone(dial, national);
  const valid = canonical !== null;
  const shownError =
    error ??
    (touched && national && !valid ? phoneErrorFor(dial, locale) : null);

  function update(nextDial: string, nextNational: string) {
    setDial(nextDial);
    setNational(formatNational(nextDial, nextNational));
    onValueChange?.(composePhone(nextDial, nextNational), nextNational);
  }

  // Indicatif + saisie : identiques dans les deux habillages.
  const control = (
    <>
      <select
        value={dial}
        onChange={(e) => update(e.target.value, national)}
        disabled={disabled}
        aria-label={isAr ? "رمز البلد" : "Indicatif pays"}
        className="text-foreground h-full shrink-0 bg-transparent pr-1 text-sm font-semibold outline-none disabled:cursor-not-allowed"
      >
        {COUNTRY_CODES.map((c) => (
          <option key={c.dial} value={c.dial}>
            {c.flag} {c.dial}
          </option>
        ))}
      </select>

      <span aria-hidden className="text-border-strong">
        |
      </span>

      <input
        id={fieldId}
        value={national}
        onChange={(e) => update(dial, e.target.value)}
        onBlur={() => setTouched(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter && valid) onEnter();
        }}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus={autoFocus}
        disabled={disabled}
        required={required}
        aria-invalid={Boolean(shownError)}
        aria-describedby={shownError ? `${fieldId}-error` : undefined}
        placeholder={
          dial === "+213" ? "06 12 34 56 78" : isAr ? "الرقم" : "Numéro"
        }
        // `h-full` : sans lui, l'input ne fait que la hauteur de sa ligne (20 px)
        // dans un conteneur de 48 — on ne peut le viser qu'au pixel près.
        className="text-foreground placeholder:text-subtle h-full w-full bg-transparent text-sm font-semibold outline-none disabled:cursor-not-allowed"
      />

      {valid && (
        <Check aria-hidden className="text-success-600 size-4 shrink-0" />
      )}
    </>
  );

  // La valeur canonique, seule chose que le serveur lit.
  const hidden = <input type="hidden" name={name} value={canonical ?? ""} />;

  if (variant === "bare") {
    return (
      <div className={cn("flex w-full items-center gap-1.5", className)}>
        {hidden}
        {control}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {shownLabel && (
        <label
          htmlFor={fieldId}
          className="text-foreground text-sm font-medium"
        >
          {shownLabel}
          {required && <span className="text-danger-600"> *</span>}
        </label>
      )}

      {hidden}

      <div
        className={cn(
          "bg-surface flex h-12 items-center gap-1.5 rounded-[12px] border pr-3.5 pl-3 transition-colors focus-within:ring-2",
          shownError
            ? "border-danger-500 focus-within:border-danger-500 focus-within:ring-danger-500/20"
            : "border-border-strong focus-within:border-primary-400 focus-within:ring-primary-400/40",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        {control}
      </div>

      {shownError ? (
        <p
          id={`${fieldId}-error`}
          role="alert"
          className="text-danger-600 px-0.5 text-[11.5px] font-medium"
        >
          {shownError}
        </p>
      ) : hint ? (
        <p className="text-subtle px-0.5 text-[11.5px] font-medium">{hint}</p>
      ) : null}
    </div>
  );
}
