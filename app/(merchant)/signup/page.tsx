"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { signup, type AuthState } from "../actions";
import { WILAYAS } from "@/lib/config/wilayas";
import { MERCHANT_CATEGORIES } from "@/lib/config/categories";
import { getCommunes } from "@/lib/config/communes";
import { APP_CONFIG } from "@/lib/config/app-config";
import { Mail, Lock, Store, MapPin, Tag, ArrowRight, Building2 } from "lucide-react";

const initialState: AuthState = {};

const SELECT_CLASS =
  "appearance-none flex h-10 w-full rounded-[10px] border border-border-strong bg-white pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 disabled:cursor-not-allowed disabled:opacity-50";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);
  const [wilayaCode, setWilayaCode] = useState("16");

  const communes = useMemo(() => getCommunes(wilayaCode), [wilayaCode]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-5">
      {/* Colonne marketing */}
      <aside className="hidden lg:flex lg:col-span-2 bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 text-white p-12 flex-col justify-between">
        <Logo variant="teal" size="xl" iconOnly className="!gap-0" />

        <div>
          <h1 className="text-4xl font-bold mb-4 leading-tight">
            Rejoignez {APP_CONFIG.name}.<br />
            Vendez sans complications.
          </h1>
          <p className="text-lg text-primary-50/90 mb-8">
            Une plateforme gratuite à l&apos;inscription. Vous ne payez qu&apos;une commission sur les commandes.
          </p>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat value="0 DA" label="Inscription" />
            <Stat value="5%" label="Commission" />
            <Stat value="2 min" label="Création de compte" />
            <Stat value="24/7" label="Support" />
          </div>
        </div>

        <p className="text-xs text-primary-50/70">
          © {new Date().getFullYear()} {APP_CONFIG.name}
        </p>
      </aside>

      {/* Formulaire */}
      <main className="lg:col-span-3 flex items-center justify-center p-4 py-8 lg:p-12 bg-surface-2 lg:bg-white">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex justify-center mb-6">
            <Logo variant="amber" size="lg" />
          </div>

          <div className="bg-white lg:bg-transparent rounded-[14px] lg:rounded-none border lg:border-0 border-border p-6 lg:p-0 shadow-sm lg:shadow-none">
            <div className="mb-6">
              <h2 className="text-2xl lg:text-3xl font-bold text-foreground mb-2">
                Créer mon compte
              </h2>
              <p className="text-sm lg:text-base text-muted">
                30 secondes et vous êtes prêt à recevoir des commandes.
              </p>
            </div>

            <form action={formAction} className="space-y-4">
              {/* Nom commerce */}
              <div className="space-y-1.5">
                <Label htmlFor="merchantName">
                  Nom du commerce <span className="text-rose-600">*</span>
                </Label>
                <div className="relative">
                  <Store className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none" />
                  <Input
                    id="merchantName"
                    name="merchantName"
                    type="text"
                    placeholder="Boulangerie El Karim"
                    required
                    disabled={pending}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Catégorie */}
              <div className="space-y-1.5">
                <Label htmlFor="category">Catégorie</Label>
                <div className="relative">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none z-10" />
                  <ChevronIcon />
                  <select
                    id="category"
                    name="category"
                    disabled={pending}
                    className={SELECT_CLASS}
                    defaultValue=""
                  >
                    <option value="">— Sélectionner une catégorie —</option>
                    {MERCHANT_CATEGORIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.emoji} {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Wilaya + Commune */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wilayaCode">Wilaya</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none z-10" />
                    <ChevronIcon />
                    <select
                      id="wilayaCode"
                      name="wilayaCode"
                      disabled={pending}
                      className={SELECT_CLASS}
                      value={wilayaCode}
                      onChange={(e) => setWilayaCode(e.target.value)}
                    >
                      <option value="">—</option>
                      {WILAYAS.map((w) => (
                        <option key={w.code} value={w.code}>
                          {w.code} · {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="city">Commune</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none z-10" />
                    {communes.length > 0 ? (
                      <>
                        <ChevronIcon />
                        <select
                          id="city"
                          name="city"
                          disabled={pending || !wilayaCode}
                          className={SELECT_CLASS}
                          defaultValue=""
                          key={wilayaCode}
                        >
                          <option value="">— Sélectionner —</option>
                          {communes.map((commune) => (
                            <option key={commune} value={commune}>
                              {commune}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <Input
                        id="city"
                        name="city"
                        type="text"
                        placeholder="Saisir la commune"
                        disabled={pending || !wilayaCode}
                        className="pl-9"
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t border-surface-3 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">
                    Email <span className="text-rose-600">*</span>
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="vous@exemple.dz"
                      required
                      disabled={pending}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 mt-3">
                  <Label htmlFor="password">
                    Mot de passe <span className="text-rose-600">*</span>
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Au moins 8 caractères"
                      minLength={8}
                      required
                      disabled={pending}
                      className="pl-9"
                    />
                  </div>
                </div>
              </div>

              {state.error && (
                <div className="rounded-[10px] bg-rose-50 border border-rose-200 px-3 py-2.5 text-sm text-rose-800">
                  {state.error}
                </div>
              )}

              {state.success && (
                <div className="rounded-[10px] bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-800">
                  {state.success}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={pending}
              >
                {pending ? "Création…" : (
                  <>
                    Créer mon compte
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>

              <p className="text-xs text-muted text-center pt-2">
                En vous inscrivant, vous acceptez les CGU de {APP_CONFIG.name}.
              </p>
            </form>

            <div className="mt-6 pt-6 border-t border-border text-center text-sm text-muted">
              Déjà inscrit ?{" "}
              <Link
                href="/login"
                className="text-primary-700 font-medium hover:underline"
              >
                Se connecter
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-primary-700/40 backdrop-blur rounded-[10px] p-3">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-primary-100/80">{label}</div>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
