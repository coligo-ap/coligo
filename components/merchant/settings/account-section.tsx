"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import {
  changePassword,
  type SettingsFormState,
} from "@/app/(merchant)/settings/actions";
import { logout } from "@/app/(merchant)/actions";

const initial: SettingsFormState = {};

export function AccountSection({
  email,
  commissionRatePct,
}: {
  email: string;
  /** Taux global de commission AFFICHÉ (info). En pourcentage déjà arrondi. */
  commissionRatePct: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(changePassword, initial);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.success ?? "Mot de passe mis à jour");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Label>Adresse email</Label>
        <p className="text-foreground text-sm font-medium">{email}</p>
      </div>

      <div className="border-border bg-surface-2 rounded-[12px] border p-4">
        <p className="text-foreground text-sm font-semibold">
          Taux de commission appliqué
        </p>
        <p className="text-primary-700 mt-1 text-2xl font-bold tabular-nums">
          {commissionRatePct}&nbsp;%
        </p>
        <p className="text-muted mt-1 text-xs">
          Taux indicatif (avant surcharges par mode cash / online).
        </p>
        <Link
          href="/finances"
          className="text-primary-700 mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Voir mes finances
          <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <form action={formAction} className="space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="text-muted size-4" />
          <p className="text-foreground text-sm font-semibold">
            Changer mon mot de passe
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Nouveau mot de passe</Label>
            <Input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirmation</Label>
            <Input
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              minLength={8}
              disabled={pending}
            />
          </div>
        </div>
        {state.error && (
          <p className="text-danger-600 text-sm">{state.error}</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Mettre à jour
        </Button>
      </form>

      <form action={logout}>
        <button
          type="submit"
          className="border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 hover:border-danger-300 inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm font-semibold transition-colors"
        >
          <LogOut className="size-4" />
          Déconnexion
        </button>
      </form>
    </div>
  );
}
