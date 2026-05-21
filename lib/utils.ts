import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDA(amountDa: number): string {
  return (
    new Intl.NumberFormat("fr-DZ", {
      maximumFractionDigits: 0,
    }).format(amountDa) + " DA"
  );
}

export function formatRelativeTime(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `il y a ${diffDays} j`;
  return date.toLocaleDateString("fr-DZ", { day: "numeric", month: "short" });
}

export function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function countItems(items: { quantity: number }[]): number {
  return items.reduce((sum, item) => sum + Number(item.quantity), 0);
}
