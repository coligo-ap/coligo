"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  acceptDriverRequest,
  blockDriver,
  refuseDriverRequest,
  removeDriver,
  unblockDriver,
  type DriverActionResult,
} from "@/app/(merchant)/livreurs/actions";

type Driver = {
  driver_id: string;
  full_name: string;
  phone: string;
  status: "pending" | "active" | "blocked";
  joined_at: string;
  status_changed_at: string;
};

export function DriversList({
  title,
  icon,
  drivers,
  variant,
  emptyHint,
}: {
  title: string;
  icon: React.ReactNode;
  drivers: Driver[];
  variant: "pending" | "active" | "blocked";
  emptyHint: string;
}) {
  return (
    <section className="border-border bg-surface space-y-3 rounded-[16px] border p-5">
      <header className="flex items-center gap-2">
        {icon}
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <span className="text-muted ml-auto text-xs tabular-nums">
          {drivers.length}
        </span>
      </header>

      {drivers.length === 0 ? (
        emptyHint ? (
          <p className="text-muted text-sm">{emptyHint}</p>
        ) : null
      ) : (
        <ul className="divide-border divide-y">
          {drivers.map((d) => (
            <DriverRow key={d.driver_id} driver={d} variant={variant} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DriverRow({
  driver,
  variant,
}: {
  driver: Driver;
  variant: "pending" | "active" | "blocked";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (
    fn: (id: string) => Promise<DriverActionResult>,
    confirmMsg?: string
  ) =>
    startTransition(async () => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      const r = await fn(driver.driver_id);
      if (r.error) toast.error(r.error);
      else toast.success(r.success ?? "OK");
      router.refresh();
    });

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{driver.full_name}</p>
        <p className="text-muted truncate text-xs tabular-nums">
          {driver.phone}
        </p>
      </div>

      {variant === "pending" && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="button"
            onClick={() =>
              run(acceptDriverRequest, "Accepter ce livreur dans ta boutique ?")
            }
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Accepter
          </Button>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => run(refuseDriverRequest, "Refuser la demande ?")}
            disabled={pending}
          >
            <X className="size-4" />
            Refuser
          </Button>
        </div>
      )}

      {variant === "active" && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() =>
              run(
                blockDriver,
                "Bloquer ce livreur : son accès est révoqué immédiatement. Continuer ?"
              )
            }
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <X className="size-4" />
            )}
            Bloquer
          </Button>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => run(removeDriver, "Retirer ce livreur ?")}
            disabled={pending}
          >
            <Trash2 className="size-4" />
            Retirer
          </Button>
        </div>
      )}

      {variant === "blocked" && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => run(unblockDriver)}
            disabled={pending}
          >
            <Undo2 className="size-4" />
            Débloquer
          </Button>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => run(removeDriver, "Retirer ce livreur ?")}
            disabled={pending}
          >
            <Trash2 className="size-4" />
            Retirer
          </Button>
        </div>
      )}
    </li>
  );
}
