"use client";

import { forwardRef, useState, type ComponentProps } from "react";
import { useLocale } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * LE champ mot de passe / code secret de l'application : un `Input` avec le
 * bouton œil afficher/masquer. À utiliser PARTOUT où l'on saisit un mot de
 * passe ou un code confidentiel (connexion, inscription, réinitialisation,
 * réglages) — plus jamais d'`<Input type="password">` nu.
 *
 * - Bouton 44 px de large sur toute la hauteur du champ (cible tactile).
 * - Propriétés logiques (`end-0`, `pe-11`) → correct en RTL (arabe).
 * - `aria-pressed` + libellé bilingue pour les lecteurs d'écran.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<typeof Input>, "type"> & {
    /** Classes du CONTENEUR (largeur max, flex…) — `className` va à l'input. */
    containerClassName?: string;
  }
>(function PasswordInput(
  { className, containerClassName, disabled, ...props },
  ref
) {
  const [show, setShow] = useState(false);
  const isAr = useLocale() === "ar";
  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        ref={ref}
        type={show ? "text" : "password"}
        disabled={disabled}
        className={cn("pe-11", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        disabled={disabled}
        aria-pressed={show}
        aria-label={
          show
            ? isAr
              ? "إخفاء كلمة المرور"
              : "Masquer le mot de passe"
            : isAr
              ? "إظهار كلمة المرور"
              : "Afficher le mot de passe"
        }
        className="text-subtle hover:text-foreground absolute inset-y-0 end-0 flex w-11 items-center justify-center disabled:opacity-50"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});
