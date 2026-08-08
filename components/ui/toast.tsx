"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Système de notifications « toast » — LA pop-up dédiée du projet.
 *
 * Règle projet : on ne confirme JAMAIS une action via console.log ;
 * on utilise toujours ce toast.
 *
 *   import { toast } from "@/components/ui/toast";
 *   toast.success("Produit créé");
 *   toast.error("Échec de la suppression");
 *
 * Le <Toaster /> est monté une seule fois dans app/layout.tsx.
 */

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; type: ToastType; message: string };

const DURATION = 3800;

let counter = 0;
let current: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const l of listeners) l([...current]);
}

function dismiss(id: number) {
  current = current.filter((t) => t.id !== id);
  emit();
}

function push(type: ToastType, message: string) {
  const id = ++counter;
  current = [...current, { id, type, message }];
  emit();
  if (typeof window !== "undefined") {
    window.setTimeout(() => dismiss(id), DURATION);
  }
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  info: (message: string) => push("info", message),
};

const TONE: Record<
  ToastType,
  { icon: typeof CheckCircle2; ring: string; iconColor: string }
> = {
  success: {
    icon: CheckCircle2,
    ring: "border-success-200",
    iconColor: "text-success-600",
  },
  error: {
    icon: XCircle,
    ring: "border-danger-200",
    iconColor: "text-danger-600",
  },
  info: {
    icon: Info,
    ring: "border-primary-200",
    iconColor: "text-primary-600",
  },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setItems);
    setItems([...current]);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
      {items.map((t) => {
        const tone = TONE[t.type];
        const Icon = tone.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "rounded-card-lg pointer-events-auto flex w-full max-w-sm items-start gap-3 border bg-white px-4 py-3 shadow-lg",
              tone.ring
            )}
          >
            <Icon className={cn("mt-0.5 size-5 shrink-0", tone.iconColor)} />
            <p className="text-foreground flex-1 text-sm font-medium">
              {t.message}
            </p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Fermer"
              className="text-subtle hover:text-foreground -mr-1 shrink-0"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
