"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  Phone,
  User as UserIcon,
} from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { COUNTRY_CODES, DEFAULT_DIAL, composePhone } from "@/lib/dz/phone";
import { updateProfile } from "@/app/(customer)/compte/actions";

/**
 * Dernière étape d'inscription (connexion Google) : on garde le HEADER et le
 * cadre « login client », on PRÉ-REMPLIT le nom et l'email récupérés de Google,
 * et il ne reste au client qu'à saisir son TÉLÉPHONE (indicatif pays, Algérie
 * par défaut). Pas de page « nue » séparée.
 */
export function PhoneGateForm({
  fullName,
  email,
  next,
}: {
  fullName: string;
  email: string;
  next: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(fullName);
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const [national, setNational] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const composed = composePhone(dial, national);
  const valid = composed !== null && name.trim().length >= 2;
  const showError = national.trim().length > 0 && composed === null;

  const submit = () =>
    start(async () => {
      if (!composed) return;
      setErr(null);
      const res = await updateProfile({ full_name: name, phone: composed });
      if (res.error) {
        setErr(res.error); // erreur EN LIGNE (pas de toast)
        return;
      }
      router.replace(next);
      router.refresh();
    });

  return (
    <>
      <div className="flex min-h-screen flex-col pb-20 lg:pb-0">
        <AuthNavBar variant="customer" />

        <main className="bg-surface-2 flex flex-1 items-center justify-center p-4 lg:p-12">
          <div className="w-full max-w-md">
            <div className="mb-8 flex justify-center lg:hidden">
              <Logo variant="amber" size="lg" />
            </div>

            <div className="border-border rounded-[16px] border bg-white p-6 shadow-sm">
              <h2 className="text-foreground mb-1 text-2xl font-bold">
                Dernière étape
              </h2>
              <p className="text-muted mb-6 text-sm">
                Vérifie tes informations et ajoute ton numéro de téléphone pour
                finaliser ton inscription.
              </p>

              <div className="space-y-4">
                {/* Nom (préremlpi depuis Google, modifiable) */}
                <div className="space-y-1.5">
                  <label className="text-foreground text-sm font-medium">
                    Nom et prénom
                  </label>
                  <div className="border-border bg-surface-2 focus-within:border-primary-400 focus-within:ring-primary-100 flex items-center gap-2.5 rounded-[12px] border px-3.5 py-3 transition focus-within:ring-2">
                    <UserIcon className="text-muted size-4 shrink-0" />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                      placeholder="Nom et prénom"
                      className="text-foreground w-full bg-transparent text-sm font-semibold outline-none"
                    />
                  </div>
                </div>

                {/* Email (préremlpi depuis Google, non modifiable ici) */}
                <div className="space-y-1.5">
                  <label className="text-foreground text-sm font-medium">
                    Email
                  </label>
                  <div className="border-border flex items-center gap-2.5 rounded-[12px] border bg-[var(--surface-2)] px-3.5 py-3 opacity-80">
                    <Mail className="text-muted size-4 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold">
                      {email || "—"}
                    </span>
                    <Lock className="text-muted size-3.5 shrink-0" />
                  </div>
                </div>

                {/* Téléphone : indicatif pays (Algérie par défaut) + numéro */}
                <div className="space-y-1.5">
                  <label className="text-foreground text-sm font-medium">
                    Téléphone <span className="text-danger-600">*</span>
                  </label>
                  <div
                    className={
                      "bg-surface-2 flex items-center gap-1.5 rounded-[12px] border pr-3.5 transition focus-within:ring-2 " +
                      (showError
                        ? "border-danger-500 focus-within:border-danger-500 focus-within:ring-danger-500/15"
                        : "border-border focus-within:border-primary-400 focus-within:ring-primary-100")
                    }
                  >
                    <select
                      value={dial}
                      onChange={(e) => setDial(e.target.value)}
                      aria-label="Indicatif pays"
                      className="text-foreground h-[46px] shrink-0 rounded-l-[12px] bg-transparent pr-1 pl-3 text-sm font-semibold outline-none"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.dial + c.name} value={c.dial}>
                          {c.flag} {c.dial}
                        </option>
                      ))}
                    </select>
                    <span className="text-border">|</span>
                    <Phone className="text-muted size-4 shrink-0" />
                    <input
                      value={national}
                      onChange={(e) => setNational(e.target.value)}
                      type="tel"
                      inputMode="tel"
                      autoFocus
                      placeholder={
                        dial === "+213" ? "06 12 34 56 78" : "Numéro"
                      }
                      aria-invalid={showError}
                      className="text-foreground w-full bg-transparent py-3 text-sm font-semibold outline-none placeholder:font-medium"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && valid && !pending) submit();
                      }}
                    />
                    {composed !== null && (
                      <CheckCircle2 className="text-success-600 size-4 shrink-0" />
                    )}
                  </div>
                  <p className="px-0.5 text-[11.5px] font-medium">
                    {showError ? (
                      <span className="text-danger-600">
                        {dial === "+213"
                          ? "Mobile algérien invalide — ex. 06 12 34 56 78."
                          : "Numéro invalide."}
                      </span>
                    ) : composed !== null ? (
                      <span className="text-success-600">Numéro valide ✓</span>
                    ) : (
                      <span className="text-muted">
                        {dial === "+213"
                          ? "Mobile algérien (05/06/07)."
                          : "Saisis ton numéro national."}
                      </span>
                    )}
                  </p>
                </div>

                {/* Erreur EN LIGNE (ex. email déjà associé) — pas de toast. */}
                {err && (
                  <p className="text-danger-600 text-center text-[12.5px] font-semibold">
                    {err}
                  </p>
                )}

                <button
                  type="button"
                  disabled={!valid || pending}
                  onClick={submit}
                  className="bg-primary-600 hover:bg-primary-700 mt-1 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-extrabold text-white shadow-[0_10px_24px_-6px_rgba(91,91,230,.45)] transition disabled:opacity-40"
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Finaliser mon inscription"
                  )}
                </button>
                <p className="text-muted text-center text-[11.5px]">
                  Un numéro valide est obligatoire (confirmation de commande et
                  contact à la livraison).
                </p>
              </div>
            </div>
          </div>
        </main>

        <AuthFooter />
      </div>
      <CustomerBottomNav />
    </>
  );
}
