"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { APP_CONFIG } from "@/lib/config/app-config";
import { adminLogin, type PortalState } from "./actions";

export const dynamic = "force-dynamic";

const initialState: PortalState = {};

const URL_ERRORS: Record<string, string> = {
  forbidden: "Accès réservé aux super-administrateurs. Connecte-toi.",
};

export default function PortailPage() {
  return (
    <Suspense fallback={null}>
      <PortailContent />
    </Suspense>
  );
}

function PortailContent() {
  const [state, formAction, pending] = useActionState(adminLogin, initialState);
  const params = useSearchParams();
  const urlError = params.get("error");
  const urlErrorMsg = urlError ? URL_ERRORS[urlError] : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-sm">
        {/* En-tête sécurisé */}
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="bg-primary-600/15 ring-primary-500/40 mb-4 flex size-14 items-center justify-center rounded-2xl ring-1">
            <ShieldCheck className="text-primary-400 size-7" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">
            Portail Super-Admin
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {APP_CONFIG.name} · accès restreint et réservé
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl backdrop-blur">
          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-300">
                Email
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="admin@coligo.dz"
                  required
                  disabled={pending}
                  className="border-slate-700 bg-slate-950 pl-9 text-slate-100 placeholder:text-slate-600"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-300">
                Mot de passe
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-slate-500" />
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  disabled={pending}
                  className="border-slate-700 bg-slate-950 pl-9 text-slate-100 placeholder:text-slate-600"
                />
              </div>
            </div>

            {(state.error || urlErrorMsg) && (
              <div className="rounded-[10px] border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
                {state.error ?? urlErrorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="bg-primary-600 hover:bg-primary-500 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connexion…
                </>
              ) : (
                <>
                  Accéder au portail
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Accès tracé et restreint aux administrateurs autorisés.
        </p>
      </div>
    </div>
  );
}
