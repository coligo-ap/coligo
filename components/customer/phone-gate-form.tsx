"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, User as UserIcon } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { AuthFooter, AuthNavBar } from "@/components/shared/auth-nav";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { PhoneField } from "@/components/ui/phone-field";
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
  // `PhoneField` ne remonte que la valeur CANONIQUE : elle vaut `null` tant que
  // le numéro est incomplet, et c'est le champ lui-même qui affiche l'erreur.
  const [composed, setComposed] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const valid = composed !== null && name.trim().length >= 2;

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
                <PhoneField
                  required
                  autoFocus
                  hint="Mobile algérien (05/06/07)."
                  onValueChange={setComposed}
                  onEnter={() => {
                    if (valid && !pending) submit();
                  }}
                />

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
