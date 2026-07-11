import { useSortable } from "@dnd-kit/sortable";

/**
 * Constantes et types partagés du catalogue marchand — extraits de
 * `catalog-view` pour que les blocs découpés (`catalog-categories`,
 * `catalog-products`, `catalog-toolbar`) les réutilisent sans cycle d'import.
 */

/** Filtre « toutes les catégories ». */
export const ALL = "__all__";
/** Conteneur / filtre « sans catégorie ». */
export const NONE = "__none__";

/** Poignée de glisser fournie par un sortable (null hors mode glisser). */
export type DragHandle = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners"
> | null;
