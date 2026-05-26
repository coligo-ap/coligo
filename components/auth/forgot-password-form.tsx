"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import {
  sendPasswordResetEmail,
  type ResetState,
} from "@/app/auth/reset-password/actions";

const initial: ResetState = {};

export function ForgotPasswordForm({
  audience,
}: {
  audience: "merchant" | "customer";
}) {
  const [state, formAction, pending] = useActionState(
    sendPasswordResetEmail,
    initial
  );
  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="audience" value={audience} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email du compte</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="ton@email.com"
          required
          disabled={pending}
        />
      </div>
      {state.error && btnState === "error" && (
        <p className="text-danger-600 text-sm">{state.error}</p>
      )}
      {state.ok && state.message && (
        <p className="border-success-200 bg-success-50 text-success-700 rounded-[10px] border px-3 py-2 text-sm">
          {state.message}
        </p>
      )}
      <ActionButton
        type="submit"
        className="w-full"
        state={btnState}
        labels={{
          idle: "Recevoir le lien",
          pending: "Envoi en cours…",
          success: "Email envoyé ✓",
          error: "Erreur, réessaie",
        }}
      />
    </form>
  );
}
