import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `tailwind-merge` ne connaît QUE l'échelle par défaut de Tailwind. Nos clés de
 * thème (cf. app/design-tokens.css) lui sont inconnues, et son validateur de
 * couleur de texte accepte n'importe quel suffixe : sans cette configuration,
 * il rangeait `text-caption` parmi les COULEURS, et toute couleur posée ensuite
 * l'écrasait comme un doublon.
 *
 *     cn("text-caption text-muted")  →  "text-muted"   ← la taille disparaît
 *
 * L'élément retombait alors sur la taille héritée (16 px) : des textes de 11 à
 * 13 px rendus bien trop gros. On déclare donc explicitement à quel groupe
 * appartient chaque famille de tokens.
 *
 * ⚠️ Toute nouvelle valeur de `--text-*`, `--radius-*` ou `--shadow-*` ajoutée
 * dans design-tokens.css doit être reportée ici, sinon le même bug revient.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "nano",
            "nano-lg",
            "micro",
            "micro-lg",
            "caption",
            "caption-lg",
            "label",
            "label-lg",
            "body-sm",
            "body",
            "body-lg",
            "body-xl",
            "title-sm",
            "title",
            "title-lg",
            "heading-sm",
            "heading",
            "heading-lg",
            "display-sm",
            "display",
          ],
        },
      ],
      rounded: [
        {
          rounded: [
            "chip",
            "control",
            "control-lg",
            "card",
            "card-lg",
            "card-xl",
            "sheet-lg",
            "sheet-xl",
            "panel",
            "panel-lg",
          ],
        },
      ],
      shadow: [{ shadow: ["float", "pop", "overlay", "sheet"] }],
    },
  },
});

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
