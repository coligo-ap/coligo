"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setAvailability } from "@/app/(driver)/actions";

export function AvailabilityToggle({
  merchantDriverId,
  status,
}: {
  merchantDriverId: string;
  status: "offline" | "available" | "busy";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isAvailable = status === "available";
  const isBusy = status === "busy";

  if (isBusy) {
    return (
      <div className="bg-warning-50 text-warning-700 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold">
        En livraison
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={isAvailable ? "secondary" : "default"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setAvailability(
            merchantDriverId,
            isAvailable ? "offline" : "available"
          );
          if (r.error) toast.error(r.error);
          router.refresh();
        })
      }
      className={cn(
        "text-xs",
        isAvailable && "bg-success-100 text-success-700"
      )}
    >
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {isAvailable ? "● Disponible" : "Devenir disponible"}
    </Button>
  );
}
