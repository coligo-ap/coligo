"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { forceDriverSignout } from "@/app/admin/actions";

/**
 * Déconnexion forcée d'un livreur (indépendante du gel/blocage) : révoque sa
 * session active. Le compte reste utilisable — il devra juste se reconnecter.
 */
export function DriverForceSignoutButton({ driverId }: { driverId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      type="button"
      variant="outline"
      onClick={() => {
        if (!confirm("Déconnecter de force ce livreur de tous ses appareils ?"))
          return;
        start(async () => {
          const r = await forceDriverSignout(driverId);
          if (r.error) toast.error(r.error);
          else toast.success(`Déconnecté (${r.killed ?? 0} session·s)`);
          router.refresh();
        });
      }}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <LogOut className="size-3.5" />
      )}
      Déconnecter
    </Button>
  );
}
