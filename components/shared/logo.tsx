import Image from "next/image";
import { APP_CONFIG } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";

interface LogoProps {
  /** Conservé pour compatibilité — le logo officiel est désormais une image unique. */
  variant?: "teal" | "amber" | "gradient-teal" | "gradient-amber";
  size?: "sm" | "md" | "lg" | "xl";
  iconOnly?: boolean;
  subtitle?: string;
  className?: string;
}

const sizes = {
  sm: { box: "size-8 p-1.5", mark: "h-5", subtitle: "text-[10px]" },
  md: { box: "size-10 p-2", mark: "h-6", subtitle: "text-xs" },
  lg: { box: "size-12 p-2.5", mark: "h-8", subtitle: "text-xs" },
  xl: { box: "size-14 p-3", mark: "h-10", subtitle: "text-sm" },
};

/**
 * Logo officiel Coligo (wordmark violet, blanc en dark mode).
 * `iconOnly` : « C » blanc sur tuile violette (lisible sur tout fond).
 */
export function Logo({
  size = "md",
  iconOnly = false,
  subtitle,
  className,
}: LogoProps) {
  const s = sizes[size];

  if (iconOnly) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl bg-[#6C2BD9] shadow-sm",
          s.box,
          className
        )}
        aria-label={APP_CONFIG.name}
      >
        <Image
          src="/brand/icon-c-white.png"
          alt={APP_CONFIG.name}
          width={325}
          height={603}
          className="h-full w-auto"
        />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-start", className)}>
      <Image
        src="/brand/logo-fr.png"
        alt={APP_CONFIG.name}
        width={800}
        height={275}
        className={cn("w-auto [.theme-dark_&]:hidden", s.mark)}
        priority
      />
      <Image
        src="/brand/logo-fr-white.png"
        alt={APP_CONFIG.name}
        width={800}
        height={275}
        className={cn("hidden w-auto [.theme-dark_&]:block", s.mark)}
        priority
      />
      {subtitle && (
        <div className={cn("text-muted mt-0.5", s.subtitle)}>{subtitle}</div>
      )}
    </div>
  );
}
