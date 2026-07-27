"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { createClient } from "@/lib/supabase/client";
import {
  updatePasswordAfterReset,
  type ResetState,
} from "@/app/auth/reset-password/actions";

const initial: ResetState = {};

/**
 * Form de saisie nouveau mot de passe. Au mount, on s'assure que la
 * session de recovery est bien établie côté client — Supabase Auth la
 * crée automatiquement à partir du fragment d'URL (#access_token=...).
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const audience = (sp.get("audience") ?? "customer") as
    | "merchant"
    | "customer";

  const [state, formAction, pending] = useActionState(
    updatePasswordAfterReset,
    initial
  );
  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // À l'arrivée sur la page, Supabase parse le fragment `#access_token=...`
    // et déclenche `PASSWORD_RECOVERY` event. On attend l'event OU on vérifie
    // qu'une session existe déjà.
    let resolved = false;
    const finish = (err?: string) => {
      if (resolved) return;
      resolved = true;
      if (err) setSessionError(err);
      else setSessionReady(true);
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") finish();
    });

    const t = setTimeout(
      () =>
        finish(
          "Lien expiré ou invalide. Refais une demande de réinitialisation."
        ),
      4000
    );
    return () => {
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (state.ok && !pending) {
      const next = audience === "merchant" ? "/login" : "/se-connecter";
      // Laisse 1.2 s pour que l'utilisateur voie "Mot de passe à jour ✓"
      // sur le bouton avant de rediriger.
      const t = setTimeout(() => router.push(next), 1200);
      return () => clearTimeout(t);
    }
  }, [state.ok, pending, router, audience]);

  if (sessionError) {
    return (
      <div className="border-danger-200 bg-danger-50 text-danger-700 rounded-[12px] border p-4 text-sm">
        {sessionError}
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <p className="text-muted flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Validation du lien…
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={pending}
        />
        <p className="text-subtle text-xs">8 caractères minimum.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirmer</Label>
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={pending}
        />
      </div>
      {state.error && btnState === "error" && (
        <p className="text-danger-600 text-sm">{state.error}</p>
      )}
      <ActionButton
        type="submit"
        className="w-full"
        state={btnState}
        labels={{
          idle: "Mettre à jour",
          pending: "Mise à jour…",
          success: "Mot de passe à jour ✓",
          error: "Erreur, réessaie",
        }}
      />
    </form>
  );
}
