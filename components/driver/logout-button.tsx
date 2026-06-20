"use client";

import { useFormStatus } from "react-dom";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { driverLogout } from "@/app/(driver)/actions";
import { setDriverOnline } from "@/lib/driver/online-store";

/** Bouton déconnexion livreur avec feedback inline (pending → loader). */
export function DriverLogoutButton() {
  return (
    <form
      action={driverLogout}
      // Déconnexion = hors ligne : on efface aussi l'intention « en ligne »
      // locale (le serveur supprime déjà la présence) → re-login part hors ligne.
      onSubmit={() => setDriverOnline(false)}
    >
      <Inner />
    </form>
  );
}

function Inner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <LogOut className="size-4" />
      )}
    </Button>
  );
}
