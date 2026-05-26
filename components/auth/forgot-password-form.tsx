"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      {state.ok && state.message && (
        <p className="border-success-200 bg-success-50 text-success-700 rounded-[10px] border px-3 py-2 text-sm">
          {state.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Recevoir le lien
      </Button>
    </form>
  );
}
