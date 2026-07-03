import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDA(amountDa: number): string {
  // Groupement des milliers MANUEL (espace) plutôt que Intl.NumberFormat :
  // l'ICU de Node (serveur) et de Chromium (client) ne produisent pas le même
  // séparateur pour "fr-DZ" (espace insécable U+202F vs U+00A0) → mismatch
  // d'hydratation React (#418) dès qu'un montant ≥ 1000 est rendu dans un
  // composant client. Le formatage manuel est identique partout.
  const n = Math.round(amountDa);
  const grouped = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n < 0 ? "-" : ""}${grouped} DA`;
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
  return items.reduce((sum, item) => {
    const q = Number(item.quantity);
    // Vente au poids/volume (1,5 kg…) : la ligne compte pour 1 article.
    return sum + (Number.isInteger(q) ? q : 1);
  }, 0);
}
