"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setDriverVerified } from "@/app/admin/drivers/actions";

export function DriverVerifyToggle({
  driverId,
  verified,
}: {
  driverId: string;
  verified: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      type="button"
      variant={verified ? "secondary" : "default"}
      onClick={() =>
        start(async () => {
          const r = await setDriverVerified(driverId, !verified);
          if (r.error) toast.error(r.error);
          else
            toast.success(verified ? "Profil non vérifié" : "Profil vérifié ✓");
          router.refresh();
        })
      }
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : verified ? (
        <ShieldX className="size-3.5" />
      ) : (
        <BadgeCheck className="size-3.5" />
      )}
      {verified ? "Retirer la vérification" : "Marquer vérifié"}
    </Button>
  );
}
