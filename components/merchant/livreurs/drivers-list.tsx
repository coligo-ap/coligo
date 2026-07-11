"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
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

type Variant = "pending" | "active" | "blocked";

const TAB_META: Record<Variant, { label: string; empty: string }> = {
  pending: { label: "Demandes", empty: "Aucune demande pour le moment." },
  active: { label: "Actifs", empty: "Aucun livreur actif." },
  blocked: { label: "Bloqués", empty: "Aucun livreur bloqué." },
};

/**
 * Une seule carte avec onglets Demandes / Actifs / Bloqués (au lieu de 3
 * listes empilées). L'onglet Bloqués n'apparaît que s'il y a des bloqués ;
 * on ouvre sur Demandes s'il y en a, sinon sur Actifs.
 */
export function DriversTabs({
  pending,
  active,
  blocked,
}: {
  pending: Driver[];
  active: Driver[];
  blocked: Driver[];
}) {
  const [tab, setTab] = useState<Variant>(
    pending.length > 0 ? "pending" : "active"
  );
  const lists: Record<Variant, Driver[]> = { pending, active, blocked };
  const tabs: Variant[] =
    blocked.length > 0
      ? ["pending", "active", "blocked"]
      : ["pending", "active"];
  const drivers = lists[tab];

  return (
    <section className="border-border bg-surface space-y-3 rounded-[16px] border p-5">
      <nav className="bg-surface-3 inline-flex max-w-full gap-0.5 rounded-[12px] p-1">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              tab === t
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            {TAB_META[t].label}
            <span
              className={cn(
                "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                t === "pending" && lists[t].length > 0
                  ? "bg-warning-100 text-warning-700"
                  : "bg-surface-2 text-muted"
              )}
            >
              {lists[t].length}
            </span>
          </button>
        ))}
      </nav>

      {drivers.length === 0 ? (
        <p className="text-muted text-sm">{TAB_META[tab].empty}</p>
      ) : (
        <ul className="divide-border divide-y">
          {drivers.map((d) => (
            <DriverRow key={d.driver_id} driver={d} variant={tab} />
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
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useActionNote();

  const run = async (
    fn: (id: string) => Promise<DriverActionResult>,
    ask?: {
      title: string;
      message?: string;
      confirmLabel?: string;
      danger?: boolean;
    }
  ) => {
    if (ask && !(await confirm(ask))) return;
    startTransition(async () => {
      const r = await fn(driver.driver_id);
      // Succès : le livreur change d'onglet / disparaît via refresh (visuel).
      if (r.error) setNote({ ok: false, text: r.error });
      else router.refresh();
    });
  };

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
              run(acceptDriverRequest, {
                title: "Accepter ce livreur dans ta boutique ?",
                confirmLabel: "Accepter",
              })
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
            onClick={() =>
              run(refuseDriverRequest, {
                title: "Refuser la demande ?",
                confirmLabel: "Refuser",
                danger: true,
              })
            }
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
              run(blockDriver, {
                title: "Bloquer ce livreur ?",
                message: "Son accès est révoqué immédiatement.",
                confirmLabel: "Bloquer",
                danger: true,
              })
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
            onClick={() =>
              run(removeDriver, {
                title: "Retirer ce livreur ?",
                confirmLabel: "Retirer",
                danger: true,
              })
            }
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
            onClick={() =>
              run(removeDriver, {
                title: "Retirer ce livreur ?",
                confirmLabel: "Retirer",
                danger: true,
              })
            }
            disabled={pending}
          >
            <Trash2 className="size-4" />
            Retirer
          </Button>
        </div>
      )}
      <ActionNote note={note} className="w-full" />
    </li>
  );
}
