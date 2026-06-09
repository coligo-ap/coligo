"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Phone, ShieldCheck } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { isValidDzPhone } from "@/lib/dz/phone";
import { updateProfile } from "@/app/(customer)/compte/actions";

/**
 * Saisie OBLIGATOIRE du numéro de téléphone (mobile algérien). Bloque l'accès
 * à la plateforme tant qu'un numéro valide n'est pas enregistré. Validation en
 * direct + bouton désactivé tant que le numéro n'est pas conforme.
 */
export function PhoneGateForm({
  fullName,
  next,
}: {
  fullName: string;
  next: string;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();

  const valid = isValidDzPhone(phone);
  const showError = phone.trim().length > 0 && !valid;

  const submit = () =>
    start(async () => {
      const res = await updateProfile({
        full_name: fullName || "Client",
        phone,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Numéro enregistré ✓");
      router.replace(next);
      router.refresh();
    });

  return (
    <div className="bg-surface-2 flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm rounded-[22px] bg-white p-6 shadow-[0_18px_44px_-22px_rgba(40,35,90,.3)]">
        <div className="bg-primary-50 text-primary-700 mb-4 flex size-12 items-center justify-center rounded-full">
          <ShieldCheck className="size-6" />
        </div>
        <h1 className="text-foreground text-xl font-extrabold tracking-tight">
          Votre numéro de téléphone
        </h1>
        <p className="text-muted mt-1.5 text-sm font-medium">
          Un numéro de mobile algérien est <b>obligatoire</b> pour utiliser
          Coligo (confirmation de commande et contact à la livraison).
        </p>

        <label className="text-muted mt-5 mb-2 block text-[11.5px] font-extrabold tracking-wide uppercase">
          Téléphone
        </label>
        <div
          className={
            "bg-surface-2 flex items-center gap-2.5 rounded-[13px] border px-3.5 py-3.5 transition focus-within:ring-2 " +
            (showError
              ? "border-[#e5484d] focus-within:border-[#e5484d] focus-within:ring-[#e5484d]/15"
              : "border-border focus-within:border-primary-400 focus-within:ring-primary-100")
          }
        >
          <Phone className="text-muted size-4 shrink-0" />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoFocus
            placeholder="06 12 34 56 78"
            aria-invalid={showError}
            className="text-foreground w-full bg-transparent text-sm font-bold outline-none placeholder:font-medium"
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !pending) submit();
            }}
          />
          {valid && <CheckCircle2 className="size-4 shrink-0 text-[#16b364]" />}
        </div>
        <p className="mt-1.5 px-0.5 text-[11.5px] font-medium">
          {showError ? (
            <span className="text-[#e5484d]">
              Numéro algérien invalide — format 0X XX XX XX XX (05/06/07).
            </span>
          ) : valid ? (
            <span className="text-[#16b364]">Numéro valide ✓</span>
          ) : (
            <span className="text-muted">
              Mobile algérien requis (ex. 06 12 34 56 78).
            </span>
          )}
        </p>

        <button
          type="button"
          disabled={!valid || pending}
          onClick={submit}
          className="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] text-[15px] font-extrabold text-white shadow-[0_10px_24px_-6px_rgba(91,91,230,.45)] transition disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Continuer"}
        </button>
      </div>
    </div>
  );
}
