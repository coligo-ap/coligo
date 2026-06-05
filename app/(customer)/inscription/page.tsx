"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Lock, Mail, Phone, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { APP_CONFIG } from "@/lib/config/app-config";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { SocialAuth } from "@/components/customer/social-auth";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";
import {
  customerSignup,
  type CustomerAuthState,
} from "@/app/(customer)/actions";

const initialState: CustomerAuthState = {};

export default function CustomerSignupPage() {
  // Suspense requise par Next 15 dès qu'on utilise useSearchParams.
  return (
    <Suspense fallback={null}>
      <CustomerSignupInner />
    </Suspense>
  );
}

function CustomerSignupInner() {
  const [state, formAction, pending] = useActionState(
    customerSignup,
    initialState
  );
  const params = useSearchParams();
  const rawNext = params.get("next") ?? "";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const loginHref =
    next === "/"
      ? "/se-connecter"
      : `/se-connecter?next=${encodeURIComponent(next)}`;

  return (
    <>
      <div className="flex min-h-screen flex-col pb-20 lg:pb-0">
        <AuthNavBar variant="customer" />
        <div className="flex flex-1 flex-col lg:grid lg:grid-cols-5">
          <aside className="from-primary-500 via-primary-600 to-primary-700 hidden flex-col justify-between bg-gradient-to-br p-12 text-white lg:col-span-2 lg:flex">
            <Logo variant="amber" size="xl" iconOnly className="!gap-0" />
            <div>
              <h1 className="mb-4 text-4xl leading-tight font-bold">
                Crée ton compte
                <br />
                en 30 secondes.
              </h1>
              <p className="text-primary-50/90 mb-8 text-lg">
                Pour commander, suivre tes retraits, et profiter du cashback.
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Stat value="0 DA" label="Inscription" />
                <Stat value="3 %" label="Cashback en moyenne" />
                <Stat value="0 file" label="d'attente" />
                <Stat value="24/7" label="Disponible" />
              </div>
            </div>
            <p className="text-primary-50/70 text-xs">
              © {new Date().getFullYear()} {APP_CONFIG.name}
            </p>
          </aside>

          <main className="bg-surface-2 flex items-center justify-center p-4 lg:col-span-3 lg:bg-white lg:p-12">
            <div className="w-full max-w-md">
              <div className="mb-8 flex justify-center lg:hidden">
                <Logo variant="amber" size="lg" />
              </div>

              <div className="border-border rounded-[14px] border bg-white p-6 shadow-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
                <h2 className="text-foreground mb-1 text-2xl font-bold lg:text-3xl">
                  Bienvenue !
                </h2>
                <p className="text-muted mb-6 text-sm">
                  Quelques infos pour commander rapidement.
                </p>

                <form action={formAction} className="space-y-4">
                  <input type="hidden" name="next" value={next} />
                  <Field
                    id="full_name"
                    label="Nom complet"
                    icon={User}
                    inputProps={{
                      name: "full_name",
                      required: true,
                      minLength: 2,
                      maxLength: 80,
                      autoComplete: "name",
                      placeholder: "Ex. Lina Hamdi",
                    }}
                    disabled={pending}
                  />

                  <Field
                    id="phone"
                    label="Téléphone"
                    hint="On le transmet au commerçant pour qu'il puisse te contacter."
                    icon={Phone}
                    inputProps={{
                      name: "phone",
                      type: "tel",
                      required: true,
                      autoComplete: "tel",
                      placeholder: "0550 12 34 56",
                      inputMode: "tel",
                    }}
                    disabled={pending}
                  />

                  <Field
                    id="email"
                    label="Email"
                    icon={Mail}
                    inputProps={{
                      name: "email",
                      type: "email",
                      required: true,
                      autoComplete: "email",
                      placeholder: "vous@exemple.dz",
                    }}
                    disabled={pending}
                  />

                  <Field
                    id="password"
                    label="Mot de passe"
                    hint="8 caractères minimum."
                    icon={Lock}
                    inputProps={{
                      name: "password",
                      type: "password",
                      required: true,
                      minLength: 8,
                      autoComplete: "new-password",
                      placeholder: "••••••••",
                    }}
                    disabled={pending}
                  />

                  {state.error && (
                    <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                      {state.error}
                    </div>
                  )}
                  {state.success && (
                    <div className="border-success-200 bg-success-50 text-success-800 rounded-[10px] border px-3 py-2.5 text-sm">
                      {state.success}
                    </div>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={pending}
                  >
                    {pending ? (
                      "Création…"
                    ) : (
                      <>
                        Créer mon compte <ArrowRight className="size-4" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="mt-5">
                  <SocialAuth next={next} />
                </div>

                <div className="border-border text-muted mt-6 border-t pt-6 text-center text-sm">
                  Déjà inscrit ?{" "}
                  <Link
                    href={loginHref}
                    className="text-primary-700 font-medium hover:underline"
                  >
                    Se connecter
                  </Link>
                </div>

                <div className="mt-6 text-center text-xs">
                  <Link href="/" className="text-muted hover:text-foreground">
                    ← Retour à l&apos;accueil
                  </Link>
                </div>
              </div>
            </div>
          </main>
        </div>
        <AuthFooter />
      </div>
      <CustomerBottomNav />
    </>
  );
}

function Field({
  id,
  label,
  hint,
  icon: Icon,
  inputProps,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input id={id} {...inputProps} disabled={disabled} className="pl-9" />
      </div>
      {hint && <p className="text-subtle text-xs">{hint}</p>}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[12px] bg-white/10 p-3">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-primary-50/80 text-xs">{label}</p>
    </div>
  );
}
