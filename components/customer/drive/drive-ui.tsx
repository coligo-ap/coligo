import type { ReactNode } from "react";
import { AlertTriangle, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { VIOLET } from "./drive-modals";

/* ─────────────── Notice « zone indisponible » + « Prévenez-moi » ─────────────── */

export function ZoneBlockNotice({
  message,
  joined,
  onJoin,
  className,
}: {
  message: string;
  joined: boolean;
  onJoin: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-center",
        className
      )}
    >
      <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-amber-800">
        <AlertTriangle className="size-3.5" />
        {message}
      </p>
      {joined ? (
        <p className="text-label mt-1.5 font-bold text-emerald-700">
          On vous prévient dès l&apos;ouverture !
        </p>
      ) : (
        <button
          type="button"
          onClick={onJoin}
          className="text-label mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 font-bold text-white"
        >
          <BellRing className="size-3.5" />
          Prévenez-moi
        </button>
      )}
    </div>
  );
}

/* ─────────────── Petits composants partagés ─────────────── */

export function Leg({
  label,
  value,
  start,
}: {
  label: string;
  value: string;
  start?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center pt-1.5">
        <span
          className={cn(
            "size-2.5",
            start ? "rounded-full" : "rounded-[2px] bg-[var(--d-ink)]"
          )}
          style={start ? { background: VIOLET } : undefined}
        />
        {start && (
          <span
            className="my-0.5 w-[2px] flex-1 opacity-40"
            style={{
              minHeight: 18,
              background:
                "repeating-linear-gradient(to bottom,#0B0C12 0 4px,transparent 4px 9px)",
            }}
          />
        )}
      </div>
      <div className="flex-1 pb-2.5">
        <p className="text-micro-lg font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-bold">{value}</p>
      </div>
    </div>
  );
}

export function OptRow({
  color,
  soft,
  icon,
  title,
  sub,
  on,
  disabled = false,
  onToggle,
}: {
  color: string;
  soft: string;
  icon: ReactNode;
  title: string;
  sub: string;
  on: boolean;
  /** Option visible mais verrouillée (ex. profil non vérifié). */
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between border-t border-[var(--d-line)] py-3"
      style={disabled ? { opacity: 0.55 } : undefined}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="rounded-control-lg grid size-[34px] shrink-0 place-items-center"
          style={{ background: soft, color }}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <b
            className="text-body block"
            style={{ color: color === "var(--d-ink)" ? undefined : color }}
          >
            {title}
          </b>
          <span className="text-caption block truncate text-[var(--d-muted)]">
            {sub}
          </span>
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onToggle}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{
          background: on ? color : "var(--d-line)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span
          className="absolute top-[3px] size-[22px] rounded-full bg-white shadow transition-all"
          style={{ left: on ? 23 : 3 }}
        />
      </button>
    </div>
  );
}
