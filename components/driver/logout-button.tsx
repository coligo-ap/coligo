"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { driverLogout } from "@/app/(driver)/actions";
import { setDriverOnline } from "@/lib/driver/online-store";
import { getActiveCourse } from "@/lib/driver/active-course-store";

/** Bouton déconnexion livreur avec feedback inline (pending → loader). */
export function DriverLogoutButton() {
  const [pending, setPending] = useState(false);

  const handle = async () => {
    // Pré-contrôle client immédiat : une course en cours BLOQUE la déconnexion
    // (le livreur doit la terminer). Le serveur revérifie (source de vérité).
    if (getActiveCourse()) {
      toast.error("Terminez votre course en cours avant de vous déconnecter.");
      return;
    }
    setPending(true);
    // Déconnexion = hors ligne : on efface aussi l'intention « en ligne » locale
    // (le serveur supprime déjà la présence) → re-login part hors ligne.
    setDriverOnline(false);
    const res = await driverLogout(); // redirige si OK
    if (res?.error) {
      setPending(false);
      toast.error(res.error);
    }
  };

  return (
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
  );
}
