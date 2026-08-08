"use client";

/**
 * Formulaire de challenge MFA TOTP — saisie du code 6 chiffres à la
 * connexion admin. À utiliser depuis /auth/mfa-challenge.
 *
 * Pipeline : `mfa.challenge({factorId})` → `mfa.verify({factorId, challengeId, code})`.
 * Après verify OK, la session est upgradée en aal2 et on redirige vers
 * `next` (par défaut /admin).
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Props = {
  factorId: string;
  next: string;
};

export function MfaChallengeForm({ factorId, next }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!/^\d{6}$/.test(code)) {
      setError("Le code doit comporter 6 chiffres.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (chErr || !ch) {
        setError(chErr?.message ?? "Échec du challenge MFA.");
        return;
      }
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code,
      });
      if (vErr) {
        setError(vErr.message ?? "Code invalide. Réessayez.");
        return;
      }
      // Session promue en aal2 — on rentre dans /admin.
      router.replace(next);
    });
  }

  return (
    <div className="mt-5">
      <label
        htmlFor="mfa-code"
        className="text-foreground sr-only text-sm font-medium"
      >
        Code à 6 chiffres
      </label>
      <input
        id="mfa-code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && code.length === 6 && !pending) submit();
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        disabled={pending}
        placeholder="000000"
        className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 block w-full rounded-md border px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em] tabular-nums focus:ring-2 focus:outline-none disabled:opacity-50"
      />

      {error && <p className="text-danger-600 mt-2 text-xs">{error}</p>}

      <Button
        size="lg"
        className="mt-4 w-full"
        onClick={submit}
        disabled={pending || code.length !== 6}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        Vérifier
      </Button>
    </div>
  );
}
