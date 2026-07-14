"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { driverLogout } from "@/app/(driver)/actions";
import { setDriverOnline } from "@/lib/driver/online-store";
import { getActiveCourse } from "@/lib/driver/active-course-store";

/** Bouton déconnexion livreur avec feedback inline (pending → loader). */
export function DriverLogoutButton() {
  const isAr = useLocale() === "ar";
  const [pending, setPending] = useState(false);
  // Message EN LIGNE : petite bulle ancrée sous le bouton icône (pas de toast).
  // Ancrée `end-0` + `max-w` → ne sort jamais de l'écran (cf. CLAUDE.md).
  const [note, setNote] = useActionNote();

  const handle = async () => {
    setNote(null);
    // Pré-contrôle client immédiat : une course en cours BLOQUE la déconnexion
    // (le livreur doit la terminer). Le serveur revérifie (source de vérité).
    if (getActiveCourse()) {
      setNote({
        ok: false,
        text: isAr
          ? "أنهِ توصيلتك الجارية قبل تسجيل الخروج."
          : "Terminez votre course en cours avant de vous déconnecter.",
      });
      return;
    }
    setPending(true);
    // Déconnexion = hors ligne : on efface aussi l'intention « en ligne » locale
    // (le serveur supprime déjà la présence) → re-login part hors ligne.
    setDriverOnline(false);
    const res = await driverLogout(); // redirige si OK
    if (res?.error) {
      setPending(false);
      setNote({ ok: false, text: res.error });
    }
  };

  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => void handle()}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogOut className="size-4" />
        )}
      </Button>
      {note && (
        <div className="border-border bg-surface absolute end-0 top-full z-50 mt-1.5 w-max max-w-[calc(100vw-2rem)] rounded-[10px] border px-2.5 py-1.5 shadow-lg">
          <ActionNote note={note} />
        </div>
      )}
    </div>
  );
}
