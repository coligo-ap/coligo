"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Machine d'états compacte pour un bouton qui déclenche une action async.
 * 4 phases visibles à l'utilisateur :
 *   idle → pending → (success | error) → idle (auto-reset 2.5s)
 *
 * Utilisation directe :
 *   const { state, run } = useActionButton();
 *   <ActionButton state={state} labels={{...}} onClick={() => run(async () => {...})} />
 *
 * Utilisation depuis `useActionState` (form server actions) :
 *   const [s, formAction, pending] = useActionState(action, {});
 *   const state = useFormActionFeedback({ pending, ok: s.ok, error: s.error });
 *   <ActionButton state={state} labels={{...}} type="submit" />
 *
 * Avantage : pas de toast bruyant, le feedback vit SUR le bouton, donc le
 * pouce du commerçant qui scroll n'a pas besoin de regarder ailleurs.
 */
export type ButtonState = "idle" | "pending" | "success" | "error";

export type ButtonLabels = {
  /** Texte normal. Ex: "Enregistrer". */
  idle: string;
  /** Texte pendant l'action. Défaut : "Enregistrement…" */
  pending?: string;
  /** Texte après succès (~2.5 s). Défaut : "Enregistré ✓" */
  success?: string;
  /** Texte après erreur (~2.5 s). Défaut : "Erreur, réessaie" */
  error?: string;
};

const RESET_MS = 2500;

/**
 * Hook pour boutons qui déclenchent une action via onClick (pas un form action).
 */
export function useActionButton() {
  const [state, setState] = useState<ButtonState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state === "success" || state === "error") {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setState("idle"), RESET_MS);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state]);

  const run = async <T>(
    fn: () => Promise<T>,
    isOk: (result: T) => boolean = () => true
  ): Promise<T | null> => {
    setState("pending");
    try {
      const result = await fn();
      setState(isOk(result) ? "success" : "error");
      return result;
    } catch {
      setState("error");
      return null;
    }
  };

  return { state, setState, run };
}

/**
 * Adaptateur pour les forms qui utilisent `useActionState`. Lit l'état du
 * transition (`pending`) + le résultat (`ok`/`error`) et retourne un
 * ButtonState compatible avec <ActionButton>.
 *
 * Auto-reset 2.5 s après success/error. Si la réponse contient ok=true ET
 * error → on traite comme error (sécurité).
 */
export function useFormActionFeedback(input: {
  pending: boolean;
  ok?: boolean;
  error?: string;
  /** Optionnel : permet de réinitialiser à idle après navigation. */
  resetKey?: unknown;
}): ButtonState {
  const [state, setState] = useState<ButtonState>("idle");
  const lastResultRef = useRef<{ ok?: boolean; error?: string }>({});

  // Phase pending
  useEffect(() => {
    if (input.pending) setState("pending");
  }, [input.pending]);

  // Phase success/error : déclenchée quand pending repasse à false ET
  // qu'un résultat est arrivé (ok ou error change).
  useEffect(() => {
    if (input.pending) return;
    const prev = lastResultRef.current;
    const changed = prev.ok !== input.ok || prev.error !== input.error;
    if (!changed) return;
    lastResultRef.current = { ok: input.ok, error: input.error };
    if (input.error) setState("error");
    else if (input.ok) setState("success");
  }, [input.pending, input.ok, input.error]);

  // Auto-reset
  useEffect(() => {
    if (state !== "success" && state !== "error") return;
    const t = setTimeout(() => setState("idle"), RESET_MS);
    return () => clearTimeout(t);
  }, [state]);

  // resetKey → force reset quand changement (ex: après navigation)
  useEffect(() => {
    if (input.resetKey !== undefined) setState("idle");
     
  }, [input.resetKey]);

  return state;
}
