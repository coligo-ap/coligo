"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, KeyRound, Loader2, LogOut } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import {
  changePassword,
  requestMerchantEmailChange,
  confirmMerchantEmailChange,
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
  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  useEffect(() => {
    if (state.ok && !pending) router.refresh();
  }, [state.ok, pending, router]);

  return (
    <div className="space-y-5">
      <EmailChange initialEmail={email} />

      <div className="border-border bg-surface-2 rounded-md border p-4">
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
            <PasswordInput
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirmation</Label>
            <PasswordInput
              name="confirm"
              autoComplete="new-password"
              required
              minLength={8}
              disabled={pending}
            />
          </div>
        </div>
        {state.error && btnState === "error" && (
          <p className="text-danger-600 text-sm">{state.error}</p>
        )}
        <ActionButton
          type="submit"
          state={btnState}
          labels={{
            idle: "Mettre à jour",
            pending: "Mise à jour…",
            success: "Mot de passe à jour ✓",
            error: "Erreur, réessaie",
          }}
        />
      </form>

      <form action={logout}>
        <LogoutButton />
      </form>
    </div>
  );
}

/**
 * Changement d'email commerçant — flux par CODE à 6 chiffres (Supabase),
 * anti-bruteforce (3 essais → 10/20 min), refus si email déjà associé à un
 * autre compte. Messages EN LIGNE (pas de toast, cf. CLAUDE.md).
 */
function EmailChange({ initialEmail }: { initialEmail: string }) {
  const [step, setStep] = useState<"idle" | "editing" | "code">("idle");
  const [email, setEmail] = useState(initialEmail);
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Label>Adresse email</Label>

      {step === "idle" && (
        <div className="flex items-center gap-2">
          <p className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
            {email}
          </p>
          <button
            type="button"
            onClick={() => {
              setNewEmail("");
              setErr(null);
              setOkMsg(null);
              setStep("editing");
            }}
            className="text-primary-700 text-body-sm shrink-0 font-semibold"
          >
            Modifier
          </button>
        </div>
      )}
      {step === "idle" && okMsg && (
        <p className="text-label font-semibold text-[#16b364]">{okMsg}</p>
      )}

      {step === "editing" && (
        <div className="space-y-2">
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => {
              setNewEmail(e.target.value);
              setErr(null);
            }}
            placeholder="nouvelle@adresse.dz"
            autoComplete="email"
            disabled={pending}
          />
          {err ? (
            <p className="text-danger-600 text-label font-semibold">{err}</p>
          ) : (
            <p className="text-muted text-label">
              Un code à 6 chiffres sera envoyé à la nouvelle adresse.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("idle")}
              className="border-border text-muted rounded-control h-10 flex-1 border text-sm font-semibold"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={pending || newEmail.trim() === ""}
              onClick={() =>
                start(async () => {
                  setErr(null);
                  const res = await requestMerchantEmailChange({
                    email: newEmail,
                  });
                  if (res.error) setErr(res.error);
                  else {
                    setCode("");
                    setStep("code");
                  }
                })
              }
              className="bg-foreground text-background rounded-control inline-flex h-10 flex-1 items-center justify-center text-sm font-semibold disabled:opacity-40"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Envoyer le code"
              )}
            </button>
          </div>
        </div>
      )}

      {step === "code" && (
        <div className="space-y-2">
          <p className="text-muted text-sm">
            Code envoyé à{" "}
            <strong className="text-foreground">{newEmail}</strong>.
          </p>
          <Input
            inputMode="numeric"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setErr(null);
            }}
            placeholder="Code à 6 chiffres"
            aria-invalid={!!err}
            className={
              "text-center text-lg font-bold tracking-[0.3em] tabular-nums " +
              (err ? "border-danger-400" : "")
            }
          />
          {err && (
            <p className="text-danger-600 text-label font-semibold">{err}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setStep("editing");
              }}
              className="border-border text-muted rounded-control h-10 flex-1 border text-sm font-semibold"
            >
              Retour
            </button>
            <button
              type="button"
              disabled={pending || code.length < 6}
              onClick={() =>
                start(async () => {
                  setErr(null);
                  const res = await confirmMerchantEmailChange({
                    email: newEmail,
                    token: code,
                  });
                  if (res.error) setErr(res.error);
                  else {
                    setEmail(newEmail.trim().toLowerCase());
                    setCode("");
                    setOkMsg(res.success ?? "Adresse email mise à jour.");
                    setStep("idle");
                  }
                })
              }
              className="bg-primary-600 hover:bg-primary-700 rounded-control inline-flex h-10 flex-1 items-center justify-center gap-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Check className="size-4" />
                  Confirmer
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 hover:border-danger-300 rounded-control inline-flex items-center gap-2 border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <LogOut className="size-4" />
      )}
      {pending ? "Déconnexion…" : "Déconnexion"}
    </button>
  );
}
