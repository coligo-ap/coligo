"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
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
    if (state.ok) {
      toast.success(state.message ?? "Mot de passe mis à jour");
      const next = audience === "merchant" ? "/login" : "/se-connecter";
      setTimeout(() => router.push(next), 700);
    }
  }, [state, router, audience]);

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
        <Input
          id="password"
          name="password"
          type="password"
          minLength={8}
          required
          disabled={pending}
        />
        <p className="text-subtle text-xs">8 caractères minimum.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirmer</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          minLength={8}
          required
          disabled={pending}
        />
      </div>
      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Mettre à jour
      </Button>
    </form>
  );
}
