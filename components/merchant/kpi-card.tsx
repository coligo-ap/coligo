import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Pourcentage de variation (peut être négatif) */
  delta?: number;
  /** Label sous le delta */
  deltaLabel?: string;
  tone?: "teal" | "amber" | "green" | "rose" | "stone";
}

const TONES = {
  teal: "bg-primary-50 text-primary-700",
  amber: "bg-primary-50 text-primary-700",
  green: "bg-green-50 text-green-700",
  rose: "bg-rose-50 text-rose-700",
  stone: "bg-surface-3 text-foreground",
};

export function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  deltaLabel,
  tone = "stone",
}: KpiCardProps) {
  return (
    <div className="border-border rounded-[14px] border bg-white p-4 lg:p-5">
      <div className="mb-3 flex items-start justify-between gap-3 lg:mb-4">
        <span className="text-muted text-xs font-medium lg:text-sm">
          {label}
        </span>
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-[10px] lg:size-9",
            TONES[tone]
          )}
        >
          <Icon className="size-4 lg:size-4" />
        </div>
      </div>

      <div className="text-2xl leading-tight font-bold tabular-nums lg:text-3xl">
        {value}
      </div>

      {delta !== undefined && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "font-semibold",
              delta >= 0 ? "text-green-600" : "text-rose-600"
            )}
          >
            {delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}%
          </span>
          {deltaLabel && <span className="text-muted">{deltaLabel}</span>}
        </div>
      )}
    </div>
  );
}
