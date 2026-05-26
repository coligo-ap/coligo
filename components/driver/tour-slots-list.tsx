"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { startTour } from "@/app/(driver)/driver/m/[mdId]/tours/actions";

type SlotItem = {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  max_orders: number;
  pendingCount: number;
  myTourId: string | null;
};

export function TourSlotsList({
  merchantDriverId,
  slots,
}: {
  merchantDriverId: string;
  slots: SlotItem[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (slots.length === 0) {
    return <p className="text-muted text-sm">Aucun créneau ouvert.</p>;
  }

  return (
    <ul className="space-y-3">
      {slots.map((s) => (
        <li
          key={s.id}
          className="border-border bg-surface space-y-2 rounded-[14px] border p-4"
        >
          <div>
            <p className="font-semibold tabular-nums">
              {new Date(s.slot_date).toLocaleDateString("fr-FR", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              })}{" "}
              · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
            </p>
            <p className="text-muted text-xs tabular-nums">
              {s.pendingCount} commande{s.pendingCount > 1 ? "s" : ""} à livrer
              {" · "}
              capacité {s.max_orders}
            </p>
          </div>
          {s.myTourId ? (
            <Link
              href={`/driver/m/${merchantDriverId}/tours/${s.myTourId}`}
              className="bg-primary-600 text-primary-50 inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold"
            >
              Continuer la tournée →
            </Link>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={pending || s.pendingCount === 0}
              onClick={() =>
                start(async () => {
                  const r = await startTour(merchantDriverId, s.id);
                  if (r.error) {
                    toast.error(r.error);
                    return;
                  }
                  if (r.tourId) {
                    router.push(
                      `/driver/m/${merchantDriverId}/tours/${r.tourId}`
                    );
                  }
                })
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Démarrer la tournée
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
