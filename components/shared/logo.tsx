import { APP_CONFIG } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";

interface LogoProps {
  variant?: "teal" | "amber" | "gradient-teal" | "gradient-amber";
  size?: "sm" | "md" | "lg" | "xl";
  iconOnly?: boolean;
  subtitle?: string;
  className?: string;
}

const sizes = {
  sm: { box: "size-8 text-base", name: "text-sm", subtitle: "text-[10px]" },
  md: { box: "size-10 text-lg", name: "text-base", subtitle: "text-xs" },
  lg: { box: "size-12 text-xl", name: "text-xl", subtitle: "text-xs" },
  xl: { box: "size-14 text-2xl", name: "text-2xl", subtitle: "text-sm" },
};

const variants = {
  teal: "bg-primary-600",
  amber: "bg-primary-500",
  "gradient-teal": "bg-gradient-to-br from-primary-400 to-primary-700",
  "gradient-amber": "bg-gradient-to-br from-primary-400 to-primary-600",
};

export function Logo({
  variant = "teal",
  size = "md",
  iconOnly = false,
  subtitle,
  className,
}: LogoProps) {
  const s = sizes[size];
  const initial = APP_CONFIG.shortName.charAt(0).toUpperCase();

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-xl font-bold text-white shadow-sm",
          variants[variant],
          s.box
        )}
        aria-label={APP_CONFIG.name}
      >
        {initial}
      </div>
      {!iconOnly && (
        <div className="min-w-0">
          <div className={cn("leading-tight font-semibold", s.name)}>
            {APP_CONFIG.name}
          </div>
          {subtitle && (
            <div className={cn("text-muted", s.subtitle)}>{subtitle}</div>
          )}
        </div>
      )}
    </div>
  );
}
