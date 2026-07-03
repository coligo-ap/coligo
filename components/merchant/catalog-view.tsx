"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import { CatalogTranslateAll } from "@/components/merchant/catalog-translate-all";
import {
  DndContext,
  closestCenter,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Search,
  Package,
  Pencil,
  ImageOff,
  PackageOpen,
  Copy,
  CheckSquare,
  Square,
  LayoutGrid,
  Rows3,
  X,
  ChevronDown,
  ChevronsDownUp,
  GripVertical,
  SlidersHorizontal,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  PRODUCT_UNIT_META,
  stockState,
  type Category,
  type ProductWithCategory,
} from "@/lib/types";
import {
  toggleProductAvailability,
  duplicateProduct,
  deleteProducts,
  reorderProducts,
  bulkSetAvailability,
  bulkAssignCategory,
} from "@/app/(merchant)/catalog/actions";
import {
  reorderCategories,
  deleteCategories,
  quickCreateCategory,
  renameCategory,
} from "@/app/(merchant)/catalog/categories/actions";

const ALL = "__all__";
const NONE = "__none__";

type SortKey =
  | "manual"
  | "recent"
  | "price_asc"
  | "price_desc"
  | "name"
  | "stock";

const SORT_LABELS: Record<SortKey, string> = {
  manual: "Manuel (glisser)",
  recent: "Plus récents",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
  name: "Nom (A→Z)",
  stock: "Stock bas d'abord",
};

export function CatalogView({
  products,
  categories,
  lowStockThreshold,
  onMutated,
}: {
  products: ProductWithCategory[];
  categories: Category[];
  lowStockThreshold: number;
  /** Après une mutation (suppression, réordonnancement…) : recharge la source.
   *  Fourni par CatalogLoader (invalide la requête TanStack) ; à défaut, repli
   *  sur router.refresh(). */
  onMutated?: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  // Porte unique de rafraîchissement après mutation (TanStack ou RSC).
  const refresh = onMutated ?? (() => router.refresh());

  // Copies locales (réordonnancement optimiste).
  const [cats, setCats] = useState(categories);
  const [prods, setProds] = useState(products);
  useEffect(() => setCats(categories), [categories]);
  useEffect(() => setProds(products), [products]);

  // Retrait OPTIMISTE de l'état local : le produit/catégorie disparaît
  // IMMÉDIATEMENT à la suppression, sans attendre le refetch (qui réconcilie en
  // fond). Évite l'effet « toast supprimé mais l'élément reste affiché ».
  const removeProductsLocal = (ids: string[]) =>
    setProds((p) => p.filter((x) => !ids.includes(x.id)));
  const removeCategoriesLocal = (ids: string[]) => {
    setCats((c) => c.filter((x) => !ids.includes(x.id)));
    // Les produits de ces catégories deviennent « sans catégorie ».
    setProds((p) =>
      p.map((x) =>
        x.category_id && ids.includes(x.category_id)
          ? { ...x, category_id: null }
          : x
      )
    );
  };

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [sort, setSort] = useState<SortKey>("manual");
  const [grouped, setGrouped] = useState(categories.length > 0);
  const [selectMode, setSelectMode] = useState(false);
  const [selProducts, setSelProducts] = useState<Set<string>>(new Set());
  const [selCats, setSelCats] = useState<Set<string>>(new Set());
  // Catégories dépliées par défaut pour que les produits (et donc la poignée de
  // glisser + les boutons monter/descendre) soient visibles d'emblée. MAIS sur
  // un gros catalogue, tout déplier rendrait des centaines de cartes d'un coup
  // et surchargerait le glisser-déposer → on ne déplie tout que si c'est léger,
  // sinon seulement la 1ʳᵉ catégorie. (Mémorisé ensuite par session.)
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    products.length <= 60
      ? new Set([...categories.map((c) => c.id), NONE])
      : new Set([categories[0]?.id ?? NONE])
  );
  const [, startTransition] = useTransition();

  // Persistance de l'état d'AFFICHAGE du catalogue (recherche, filtre catégorie,
  // tri, vue groupée, catégories dépliées) pour la SESSION : en allant éditer /
  // créer un produit puis en revenant (bouton retour), le commerçant retrouve la
  // page EXACTEMENT comme il l'avait laissée. sessionStorage scopé par commerce.
  const uiKey = `coligo:catalog:ui:${products[0]?.merchant_id ?? "x"}`;
  const firstPersist = useRef(true);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(uiKey);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        query?: string;
        categoryId?: string;
        sort?: SortKey;
        grouped?: boolean;
        expanded?: string[];
      };
      if (typeof s.query === "string") setQuery(s.query);
      if (typeof s.categoryId === "string") setCategoryId(s.categoryId);
      if (typeof s.sort === "string") setSort(s.sort);
      if (typeof s.grouped === "boolean") setGrouped(s.grouped);
      if (Array.isArray(s.expanded)) setExpanded(new Set(s.expanded));
    } catch {
      /* sessionStorage indispo / JSON cassé → on ignore */
    }
  }, [uiKey]);
  useEffect(() => {
    // On saute le 1er passage (montage avec les valeurs par défaut / en cours de
    // restauration) pour ne PAS écraser ce qui est stocké.
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    try {
      sessionStorage.setItem(
        uiKey,
        JSON.stringify({
          query,
          categoryId,
          sort,
          grouped,
          expanded: [...expanded],
        })
      );
    } catch {
      /* ignore */
    }
  }, [uiKey, query, categoryId, sort, grouped, expanded]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleSelProduct(id: string) {
    setSelProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelCat(id: string) {
    setSelCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelProducts(new Set());
    setSelCats(new Set());
  }
  function selectAllInCategory(ids: string[]) {
    setSelProducts((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = prods.filter((p) => {
      if (categoryId === NONE && p.category_id) return false;
      if (
        categoryId !== ALL &&
        categoryId !== NONE &&
        p.category_id !== categoryId
      )
        return false;
      if (!q) return true;
      return (
        p.name_fr.toLowerCase().includes(q) ||
        (p.name_ar ?? "").toLowerCase().includes(q) ||
        (p.categories?.title ?? "").toLowerCase().includes(q)
      );
    });

    // En vue GROUPÉE, on affiche TOUJOURS l'ordre manuel (= positions serveur,
    // le classement choisi par le commerçant) : c'est ce qui permet de
    // glisser/réordonner de façon cohérente et ce que voit le client. Le tri
    // (prix, nom, stock…) ne s'applique qu'en vue grille (non groupée).
    if (sort === "manual" || grouped) return list;

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "price_asc":
          return a.price_da - b.price_da;
        case "price_desc":
          return b.price_da - a.price_da;
        case "name":
          return a.name_fr.localeCompare(b.name_fr, "fr");
        case "stock":
          return (a.stock_qty ?? Infinity) - (b.stock_qty ?? Infinity);
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return sorted;
  }, [prods, query, categoryId, sort, grouped]);

  const groups = useMemo(() => {
    if (!grouped) return null;
    const byCat = new Map<string, ProductWithCategory[]>();
    const uncategorized: ProductWithCategory[] = [];
    for (const p of filtered) {
      if (!p.category_id) uncategorized.push(p);
      else {
        if (!byCat.has(p.category_id)) byCat.set(p.category_id, []);
        byCat.get(p.category_id)!.push(p);
      }
    }
    const showEmpty = query.trim() === "" && categoryId === ALL;
    const ordered = cats
      .filter((c) => showEmpty || byCat.has(c.id))
      .map((c) => ({
        key: c.id,
        title: c.title,
        image: c.image_url,
        items: byCat.get(c.id) ?? [],
      }));
    if (uncategorized.length > 0)
      ordered.push({
        key: NONE,
        title: "Sans catégorie",
        image: null,
        items: uncategorized,
      });
    return ordered;
  }, [grouped, filtered, cats, query, categoryId]);

  const allExpanded =
    !!groups && groups.length > 0 && groups.every((g) => expanded.has(g.key));
  function toggleAll() {
    if (!groups) return;
    setExpanded(allExpanded ? new Set() : new Set(groups.map((g) => g.key)));
  }

  const noQuery = query.trim() === "";
  // DnD : produits réordonnables ET déplaçables ENTRE catégories dès qu'on est en
  // vue groupée (qui affiche toujours l'ordre manuel), hors sélection/recherche.
  // Plus de condition sur le tri : en groupé l'ordre EST l'ordre manuel, donc le
  // glisser et les boutons sont toujours cohérents et visibles.
  const productsDraggable = grouped && !selectMode && noQuery;
  // DnD : catégories réordonnables en vue groupée, hors sélection/recherche.
  const categoriesDraggable = grouped && !selectMode && noQuery;

  // ─── Drag-and-drop unifié (vue groupée) ───────────────────────────────────
  // Un SEUL DndContext gère à la fois le réordonnancement des CATÉGORIES et le
  // déplacement des PRODUITS d'une catégorie à l'autre (pattern multi-conteneurs
  // dnd-kit). Identifiants :
  //   • catégorie (sortable)  → "cat:<id>"
  //   • produit (sortable)    → l'uuid brut
  //   • conteneur (droppable) → l'id de catégorie brut, ou NONE
  const CAT_PREFIX = "cat:";
  const containerKeys = useMemo(() => [...cats.map((c) => c.id), NONE], [cats]);
  const isContainerId = (id: string) =>
    id === NONE || cats.some((c) => c.id === id);
  const containerOf = (
    list: ProductWithCategory[],
    id: string
  ): string | null => {
    const p = list.find((x) => x.id === id);
    return p ? (p.category_id ?? NONE) : null;
  };

  // Origine d'un drag produit (id + conteneur de départ) → savoir si la
  // catégorie a changé au lâcher (⇒ persister category_id en plus des positions).
  const dragOrigin = useRef<{ id: string; from: string } | null>(null);

  function buildContainers(list: ProductWithCategory[]): Map<string, string[]> {
    const conts = new Map<string, string[]>();
    for (const k of containerKeys) conts.set(k, []);
    for (const p of list) {
      const k = p.category_id ?? NONE;
      if (!conts.has(k)) conts.set(k, []);
      conts.get(k)!.push(p.id);
    }
    return conts;
  }

  function flattenContainers(
    conts: Map<string, string[]>,
    byId: Map<string, ProductWithCategory>
  ): ProductWithCategory[] {
    const out: ProductWithCategory[] = [];
    for (const [k, ids] of conts) {
      const cat = k === NONE ? null : k;
      const title = cat ? (cats.find((c) => c.id === cat)?.title ?? "") : "";
      for (const id of ids) {
        const p = byId.get(id);
        if (!p) continue;
        out.push(
          (p.category_id ?? null) === cat
            ? p
            : {
                ...p,
                category_id: cat,
                categories: cat ? { id: cat, title } : null,
              }
        );
      }
    }
    return out;
  }

  // Collision dépendante du type tiré.
  //  • Catégorie : ne se compare qu'aux catégories (tri vertical, closestCenter).
  //  • Produit   : PRIORITÉ aux produits réellement sous le pointeur (sinon le
  //    grand conteneur droppable de catégorie « gagnerait » et casserait le tri
  //    intra-catégorie). On ne retombe sur le conteneur que si le pointeur n'est
  //    au-dessus d'aucun produit (zone vide / catégorie repliée).
  const collision: CollisionDetection = (args) => {
    const activeId = String(args.active.id);

    if (activeId.startsWith(CAT_PREFIX)) {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          String(c.id).startsWith(CAT_PREFIX)
        ),
      });
    }

    // Produit : on exclut les sortables de catégorie.
    const productArgs = {
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => !String(c.id).startsWith(CAT_PREFIX)
      ),
    };
    const pointer = pointerWithin(productArgs);
    const pointerItems = pointer.filter((c) => !isContainerId(String(c.id)));
    if (pointerItems.length > 0) return pointerItems; // produit sous le pointeur
    if (pointer.length > 0) return pointer; // sinon conteneur sous le pointeur
    const inter = rectIntersection(productArgs);
    const interItems = inter.filter((c) => !isContainerId(String(c.id)));
    if (interItems.length > 0) return interItems;
    if (inter.length > 0) return inter;
    return closestCorners(productArgs);
  };

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    if (id.startsWith(CAT_PREFIX)) {
      dragOrigin.current = null;
      return;
    }
    dragOrigin.current = { id, from: containerOf(prods, id) ?? NONE };
  }

  // Survol : si le produit passe au-dessus d'un AUTRE conteneur, on le déplace
  // optimistiquement (la carte change de section en direct).
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    if (activeId.startsWith(CAT_PREFIX)) return; // drag de catégorie : rien ici
    const overId = String(over.id);
    setProds((prev) => {
      const from = containerOf(prev, activeId);
      const to = isContainerId(overId) ? overId : containerOf(prev, overId);
      if (from == null || to == null || from === to) return prev;
      const byId = new Map(prev.map((p) => [p.id, p]));
      const conts = buildContainers(prev);
      for (const ids of conts.values()) {
        const i = ids.indexOf(activeId);
        if (i >= 0) ids.splice(i, 1);
      }
      const dest = conts.get(to)!;
      let at = dest.length;
      if (!isContainerId(overId)) {
        const oi = dest.indexOf(overId);
        at = oi >= 0 ? oi : dest.length;
      }
      dest.splice(at, 0, activeId);
      return flattenContainers(conts, byId);
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const activeId = String(active.id);

    // ── Réordonnancement de CATÉGORIES ──
    if (activeId.startsWith(CAT_PREFIX)) {
      if (!over) return;
      const a = activeId.slice(CAT_PREFIX.length);
      const o = String(over.id).startsWith(CAT_PREFIX)
        ? String(over.id).slice(CAT_PREFIX.length)
        : null;
      if (!o || a === o) return;
      const oldI = cats.findIndex((c) => c.id === a);
      const newI = cats.findIndex((c) => c.id === o);
      if (oldI === -1 || newI === -1) return;
      const next = arrayMove(cats, oldI, newI);
      setCats(next);
      startTransition(async () => {
        const res = await reorderCategories(next.map((c) => c.id));
        if (res?.error) {
          toast.error(res.error);
          return;
        }
        // Réconcilie avec le serveur : ce qui s'affiche = ce qui est enregistré.
        refresh();
      });
      return;
    }

    // ── Déplacement / réordonnancement d'un PRODUIT ──
    const origin = dragOrigin.current;
    dragOrigin.current = null;

    // Conteneur LIVE de l'actif (déjà déplacé par onDragOver le cas échéant).
    const to = containerOf(prods, activeId);
    if (to == null) return;
    const byId = new Map(prods.map((p) => [p.id, p]));
    const conts = buildContainers(prods);
    const dest = conts.get(to)!;
    if (over) {
      const overId = String(over.id);
      const oldI = dest.indexOf(activeId);
      const newI = isContainerId(overId)
        ? dest.length - 1
        : dest.indexOf(overId);
      if (oldI >= 0 && newI >= 0 && oldI !== newI) {
        conts.set(to, arrayMove(dest, oldI, newI));
      }
    }
    const next = flattenContainers(conts, byId);
    setProds(next);

    // Persistance : réassigne la catégorie si elle a changé, puis renumérote les
    // positions du conteneur de destination.
    const destIds = (conts.get(to) ?? []).slice();
    const categoryChanged = !!origin && origin.from !== to;
    startTransition(async () => {
      if (categoryChanged) {
        const r1 = await bulkAssignCategory(
          [activeId],
          to === NONE ? null : to
        );
        if (r1?.error) {
          toast.error(r1.error);
          return;
        }
      }
      const r2 = await reorderProducts(destIds);
      if (r2?.error) {
        toast.error(r2.error);
        return;
      }
      // Réconcilie avec le serveur : ce qui s'affiche = ce qui est enregistré.
      refresh();
    });
  }

  // ─── Repli SANS glisser (boutons) ─────────────────────────────────────────
  // Sur vieux WebView (Sunmi) le glisser-déposer peut ne pas fonctionner : ces
  // commandes natives (boutons + <select>) font le même reclassement, partout.

  /** Monte/descend un produit d'un cran DANS sa catégorie. */
  function moveProductWithin(productId: string, dir: "up" | "down") {
    const prod = prods.find((p) => p.id === productId);
    if (!prod) return;
    const catKey = prod.category_id ?? NONE;
    const ids = prods
      .filter((p) => (p.category_id ?? NONE) === catKey)
      .map((p) => p.id);
    const i = ids.indexOf(productId);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= ids.length) return;
    const newIds = arrayMove(ids, i, j);
    setProds((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      const conts = buildContainers(prev);
      conts.set(catKey, newIds);
      return flattenContainers(conts, byId);
    });
    startTransition(async () => {
      const res = await reorderProducts(newIds);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      refresh();
    });
  }

  /** Déplace un produit vers une autre catégorie (ajouté en fin de destination). */
  function moveProductToCategory(productId: string, newCat: string | null) {
    const prod = prods.find((p) => p.id === productId);
    if (!prod) return;
    const fromKey = prod.category_id ?? NONE;
    const toKey = newCat ?? NONE;
    if (fromKey === toKey) return;
    setProds((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      const conts = buildContainers(prev);
      for (const ids of conts.values()) {
        const k = ids.indexOf(productId);
        if (k >= 0) ids.splice(k, 1);
      }
      if (!conts.has(toKey)) conts.set(toKey, []);
      conts.get(toKey)!.push(productId);
      return flattenContainers(conts, byId);
    });
    const destIds = [
      ...prods
        .filter((p) => (p.category_id ?? NONE) === toKey && p.id !== productId)
        .map((p) => p.id),
      productId,
    ];
    startTransition(async () => {
      const r1 = await bulkAssignCategory([productId], newCat);
      if (r1?.error) {
        toast.error(r1.error);
        return;
      }
      const r2 = await reorderProducts(destIds);
      if (r2?.error) {
        toast.error(r2.error);
        return;
      }
      refresh();
    });
  }

  async function deleteSelectedProducts() {
    const ids = Array.from(selProducts);
    if (
      !(await confirm({
        title: `Supprimer ${ids.length} produit${ids.length > 1 ? "s" : ""} ?`,
        message: "Action irréversible.",
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteProducts(ids);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${ids.length} produit${ids.length > 1 ? "s" : ""} supprimé${ids.length > 1 ? "s" : ""}`
      );
      removeProductsLocal(ids);
      clearSelection();
      refresh();
    });
  }
  async function deleteSelectedCategories() {
    const ids = Array.from(selCats);
    if (
      !(await confirm({
        title: `Supprimer ${ids.length} catégorie${ids.length > 1 ? "s" : ""} ?`,
        message: "Les produits liés deviendront « sans catégorie ».",
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteCategories(ids);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${ids.length} catégorie${ids.length > 1 ? "s" : ""} supprimée${ids.length > 1 ? "s" : ""}`
      );
      removeCategoriesLocal(ids);
      clearSelection();
      refresh();
    });
  }
  function bulk(
    fn: () => Promise<{ error?: string } | void>,
    successMsg: string,
    onOptimistic?: () => void
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(successMsg);
      onOptimistic?.();
      clearSelection();
      refresh();
    });
  }

  // Création INLINE d'une catégorie (plus de page dédiée).
  async function promptCreateCategory() {
    const name = await prompt({
      title: "Nouvelle catégorie",
      placeholder: "Ex. Boissons, Pains…",
      confirmLabel: "Créer",
    });
    const clean = name?.trim();
    if (!clean) return;
    startTransition(async () => {
      const res = await quickCreateCategory(clean);
      if (res.error || !res.id) {
        toast.error(res.error ?? "Échec de la création.");
        return;
      }
      setCats((prev) => [
        ...prev,
        {
          id: res.id!,
          merchant_id: products[0]?.merchant_id ?? "",
          title: res.title ?? clean,
          description: null,
          image_url: null,
          position: prev.length,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      toast.success(`Catégorie « ${res.title ?? clean} » créée`);
      refresh();
    });
  }

  // Renommage INLINE d'une catégorie (optimiste + repli si erreur serveur).
  async function promptRename(id: string, current: string) {
    const name = await prompt({
      title: "Renommer la catégorie",
      initialValue: current,
      confirmLabel: "Renommer",
    });
    if (name === null) return;
    const clean = name.trim();
    if (!clean || clean === current) return;
    setCats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: clean } : c))
    );
    startTransition(async () => {
      const res = await renameCategory(id, clean);
      if (res.error) {
        toast.error(res.error);
        setCats((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title: current } : c))
        );
        return;
      }
      toast.success("Catégorie renommée");
      refresh();
    });
  }

  const availableCount = prods.filter((p) => p.is_available).length;
  const sortableCatKeys = (groups ?? [])
    .filter((g) => g.key !== NONE)
    .map((g) => `${CAT_PREFIX}${g.key}`);

  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:p-6 lg:px-8">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Catalogue
          </h1>
          <p className="text-muted mt-1 text-sm">
            {prods.length} produit{prods.length > 1 ? "s" : ""} ·{" "}
            {availableCount} disponible{availableCount > 1 ? "s" : ""} ·{" "}
            {cats.length} catégorie
            {cats.length > 1 ? "s" : ""}
          </p>
        </div>
        {/* Sur mobile : les deux boutons sur la MÊME ligne (50/50) pour gagner
            de la place ; libellés raccourcis. Sur ≥sm : libellés complets. */}
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <CatalogTranslateAll onDone={refresh} />
          <button
            type="button"
            onClick={promptCreateCategory}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex-1 justify-center sm:flex-initial"
            )}
          >
            <Plus className="size-4" />
            <span className="sm:hidden">Catégorie</span>
            <span className="hidden sm:inline">Nouvelle catégorie</span>
          </button>
          <Link
            href="/catalog/new"
            className={cn(
              buttonVariants(),
              "flex-1 justify-center sm:flex-initial"
            )}
          >
            <Plus className="size-4" />
            <span className="sm:hidden">Produit</span>
            <span className="hidden sm:inline">Nouveau produit</span>
          </Link>
        </div>
      </header>

      {/* Barre recherche + outils */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Rechercher un produit ou une catégorie…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Le tri ne s'applique qu'en vue GRILLE (non groupée). En vue groupée
              l'ordre est toujours le classement manuel (réordonnable). */}
          {!grouped && (
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="border-border-strong focus:ring-primary-400 h-11 rounded-[12px] border bg-white px-3 text-sm focus:ring-2 focus:outline-none"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          )}

          {/* Outils secondaires regroupés dans UN menu (la barre restait
              chargée sur mobile avec 3 boutons toujours visibles). */}
          <ToolsMenu
            grouped={grouped}
            onToggleGrouped={() => setGrouped((v) => !v)}
            selectMode={selectMode}
            onToggleSelectMode={() => {
              setSelectMode((v) => !v);
              clearSelection();
            }}
            canFold={Boolean(grouped && groups && groups.length > 0)}
            allExpanded={allExpanded}
            onToggleFold={toggleAll}
          />
        </div>
      </div>

      {/* Bandeau mode sélection : rappel visible + sortie en un tap. */}
      {selectMode && selProducts.size === 0 && selCats.size === 0 && (
        <div className="border-primary-200 bg-primary-50 text-primary-800 mb-4 flex items-center justify-between gap-2 rounded-[12px] border px-3 py-2 text-sm">
          <span>Touchez des produits pour les sélectionner.</span>
          <button
            type="button"
            onClick={() => {
              setSelectMode(false);
              clearSelection();
            }}
            className="hover:bg-primary-100 rounded-[8px] px-2 py-1 text-xs font-semibold"
          >
            Quitter
          </button>
        </div>
      )}

      {/* Chips catégories */}
      {cats.length > 0 && (
        <div className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
          <CategoryChip
            label="Toutes"
            active={categoryId === ALL}
            onClick={() => setCategoryId(ALL)}
          />
          {cats.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.title}
              active={categoryId === c.id}
              onClick={() => setCategoryId(c.id)}
            />
          ))}
          <CategoryChip
            label="Sans catégorie"
            active={categoryId === NONE}
            onClick={() => setCategoryId(NONE)}
          />
        </div>
      )}

      {/* Contenu */}
      {prods.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Aucun produit ne correspond à votre recherche.
        </p>
      ) : groups ? (
        <>
          {productsDraggable && (
            <p className="text-subtle mb-3 flex items-center gap-1.5 px-1 text-xs">
              <GripVertical className="size-3.5 shrink-0" />
              Glissez un produit pour le réordonner ou le déposer dans une autre
              catégorie. L&apos;ordre est répercuté côté client.
            </p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={sortableCatKeys}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {groups.map((g) => {
                  const ids = g.items.map((p) => p.id);
                  const allSel =
                    ids.length > 0 && ids.every((id) => selProducts.has(id));
                  return (
                    <DroppableCategory
                      key={g.key}
                      id={g.key}
                      active={productsDraggable}
                    >
                      <SortableCategory
                        id={`${CAT_PREFIX}${g.key}`}
                        sortable={categoriesDraggable && g.key !== NONE}
                      >
                        {(handle) => (
                          <CategorySection
                            title={g.title}
                            image={g.image}
                            count={g.items.length}
                            open={expanded.has(g.key)}
                            onToggle={() => toggleExpanded(g.key)}
                            onRename={
                              g.key !== NONE
                                ? () => promptRename(g.key, g.title)
                                : null
                            }
                            addHref={
                              g.key !== NONE
                                ? `/catalog/new?category=${g.key}`
                                : "/catalog/new"
                            }
                            selectMode={selectMode}
                            selectable={g.key !== NONE}
                            selected={selCats.has(g.key)}
                            onToggleSelect={() => toggleSelCat(g.key)}
                            onDelete={
                              g.key !== NONE
                                ? async () => {
                                    if (
                                      await confirm({
                                        title: "Supprimer cette catégorie ?",
                                        message:
                                          "Les produits liés deviendront « sans catégorie ».",
                                        confirmLabel: "Supprimer",
                                        danger: true,
                                      })
                                    )
                                      bulk(
                                        () => deleteCategories([g.key]),
                                        "Catégorie supprimée",
                                        () => removeCategoriesLocal([g.key])
                                      );
                                  }
                                : null
                            }
                            dragHandle={handle}
                          >
                            {selectMode && ids.length > 0 && (
                              <button
                                type="button"
                                onClick={() => selectAllInCategory(ids)}
                                className="text-primary-700 hover:bg-primary-50 mb-3 inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-xs font-medium"
                              >
                                {allSel ? (
                                  <CheckSquare className="size-4" />
                                ) : (
                                  <Square className="size-4" />
                                )}
                                {allSel
                                  ? "Tout désélectionner"
                                  : "Tout sélectionner"}
                              </button>
                            )}
                            {g.items.length === 0 ? (
                              <p className="text-muted py-4 text-center text-sm">
                                Aucun produit dans cette catégorie.
                              </p>
                            ) : (
                              <SortableContext
                                items={ids}
                                strategy={rectSortingStrategy}
                              >
                                <ProductItems
                                  products={g.items}
                                  draggable={productsDraggable}
                                  showMoveControls={productsDraggable}
                                  categories={cats}
                                  onMoveProduct={moveProductWithin}
                                  onMoveProductToCategory={
                                    moveProductToCategory
                                  }
                                  lowStockThreshold={lowStockThreshold}
                                  selectMode={selectMode}
                                  selected={selProducts}
                                  onToggleSelect={toggleSelProduct}
                                  onDeleted={(id) => {
                                    removeProductsLocal([id]);
                                    refresh();
                                  }}
                                />
                              </SortableContext>
                            )}
                          </CategorySection>
                        )}
                      </SortableCategory>
                    </DroppableCategory>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </>
      ) : (
        <ProductItems
          products={filtered}
          draggable={false}
          lowStockThreshold={lowStockThreshold}
          selectMode={selectMode}
          selected={selProducts}
          onToggleSelect={toggleSelProduct}
          onDeleted={(id) => {
            removeProductsLocal([id]);
            refresh();
          }}
        />
      )}

      {/* Barre d'actions groupées */}
      {(selProducts.size > 0 || selCats.size > 0) && (
        <BulkBar
          productCount={selProducts.size}
          categoryCount={selCats.size}
          categories={cats}
          onClear={clearSelection}
          onSetAvailability={(v) =>
            bulk(
              () => bulkSetAvailability(Array.from(selProducts), v),
              v ? "Produits rendus disponibles" : "Produits masqués"
            )
          }
          onAssign={(catId) =>
            bulk(
              () =>
                bulkAssignCategory(
                  Array.from(selProducts),
                  catId === NONE ? null : catId
                ),
              "Catégorie assignée"
            )
          }
          onDeleteProducts={deleteSelectedProducts}
          onDeleteCategories={deleteSelectedCategories}
        />
      )}
    </div>
  );
}

/**
 * Menu « Outils » : regroupe les options secondaires (vue groupée/grille,
 * sélection multiple, tout déplier/replier) derrière un seul bouton pour
 * alléger la barre, surtout sur mobile.
 */
function ToolsMenu({
  grouped,
  onToggleGrouped,
  selectMode,
  onToggleSelectMode,
  canFold,
  allExpanded,
  onToggleFold,
}: {
  grouped: boolean;
  onToggleGrouped: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  canFold: boolean;
  allExpanded: boolean;
  onToggleFold: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item =
    "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm hover:bg-surface-2";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Outils"
        aria-expanded={open}
        className={cn(
          "flex size-11 items-center justify-center rounded-[12px] border transition-colors",
          selectMode
            ? "border-primary-600 bg-primary-50 text-primary-700"
            : "border-border-strong text-muted hover:bg-surface-2"
        )}
      >
        <SlidersHorizontal className="size-4" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="border-border bg-surface absolute right-0 z-40 mt-2 w-60 rounded-[12px] border p-1 shadow-lg">
            <button
              type="button"
              className={item}
              onClick={() => {
                onToggleGrouped();
                setOpen(false);
              }}
            >
              {grouped ? (
                <LayoutGrid className="text-muted size-4" />
              ) : (
                <Rows3 className="text-muted size-4" />
              )}
              {grouped ? "Vue grille" : "Grouper par catégorie"}
            </button>
            <button
              type="button"
              className={cn(item, selectMode && "text-primary-700 font-medium")}
              onClick={() => {
                onToggleSelectMode();
                setOpen(false);
              }}
            >
              <CheckSquare
                className={cn(
                  "size-4",
                  selectMode ? "text-primary-600" : "text-muted"
                )}
              />
              {selectMode
                ? "Quitter la sélection multiple"
                : "Sélection multiple"}
            </button>
            {canFold && (
              <button
                type="button"
                className={item}
                onClick={() => {
                  onToggleFold();
                  setOpen(false);
                }}
              >
                <ChevronsDownUp
                  className={cn(
                    "text-muted size-4",
                    !allExpanded && "rotate-180"
                  )}
                />
                {allExpanded ? "Tout replier" : "Tout déplier"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "border-primary-600 bg-primary-600 text-white"
          : "border-border-strong text-muted hover:bg-surface-2"
      )}
    >
      {label}
    </button>
  );
}

type DragHandle = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners"
> | null;

/** Commandes de reclassement SANS glisser (repli compatible vieux WebView). */
type MoveControls = {
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
  categories: Category[];
  currentCategoryId: string;
  onMoveToCategory: (categoryId: string | null) => void;
} | null;

function SortableCategory({
  id,
  sortable,
  children,
}: {
  id: string;
  sortable: boolean;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children(sortable ? { attributes, listeners } : null)}
    </div>
  );
}

function CategorySection({
  title,
  image,
  count,
  open,
  onToggle,
  onRename,
  addHref,
  selectMode,
  selectable,
  selected,
  onToggleSelect,
  onDelete,
  dragHandle,
  children,
}: {
  title: string;
  image: string | null;
  count: number;
  open: boolean;
  onToggle: () => void;
  onRename: (() => void) | null;
  addHref: string;
  selectMode: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: (() => void) | null;
  dragHandle: DragHandle;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "border-border bg-surface overflow-hidden rounded-[16px] border",
        selected && "ring-primary-500 ring-2"
      )}
    >
      <div className="hover:bg-surface-2 flex items-center gap-2 px-3 py-2.5 transition-colors">
        {dragHandle && (
          <button
            type="button"
            className="text-subtle hover:text-foreground -ml-1 cursor-grab touch-none active:cursor-grabbing"
            aria-label="Déplacer la catégorie"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}

        {selectMode && selectable && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-pressed={selected}
            className="inline-flex items-center"
          >
            {selected ? (
              <CheckSquare className="text-primary-600 size-5" />
            ) : (
              <Square className="text-muted size-5" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="bg-surface-3 relative size-9 shrink-0 overflow-hidden rounded-[8px]">
            {image ? (
              <Image
                src={image}
                alt={title}
                fill
                sizes="36px"
                className="object-cover"
              />
            ) : (
              <span className="text-subtle flex h-full items-center justify-center">
                <ImageOff className="size-4" />
              </span>
            )}
          </div>
          <span className="truncate text-sm font-semibold">{title}</span>
          <span className="bg-surface-3 text-muted rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums">
            {count}
          </span>
        </button>

        <Link
          href={addHref}
          title="Ajouter un produit à cette catégorie"
          className="border-border-strong text-primary-700 hover:bg-primary-50 inline-flex h-9 items-center gap-1 rounded-[10px] border px-2.5 text-xs font-medium"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Produit</span>
        </Link>
        {onRename && (
          <button
            type="button"
            onClick={onRename}
            title="Renommer la catégorie"
            className="text-muted hover:bg-surface-3 hover:text-foreground inline-flex size-9 items-center justify-center rounded-[10px]"
          >
            <Pencil className="size-4" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="Supprimer la catégorie"
            className="text-muted hover:bg-danger-50 hover:text-danger-600 inline-flex size-9 items-center justify-center rounded-[10px]"
          >
            <Trash2 className="size-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Replier" : "Déplier"}
          className="text-muted hover:bg-surface-3 ml-0.5 inline-flex size-9 items-center justify-center rounded-[10px]"
        >
          <ChevronDown
            className={cn("size-5 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && <div className="px-4 pt-1 pb-4">{children}</div>}
    </section>
  );
}

const GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5";

/**
 * Grille de produits. Le DndContext + SortableContext sont fournis par le
 * parent (vue groupée) pour permettre le déplacement ENTRE catégories : ici on
 * ne fait que rendre la grille, sortable ou non.
 */
function ProductItems({
  products,
  draggable,
  showMoveControls,
  categories,
  onMoveProduct,
  onMoveProductToCategory,
  lowStockThreshold,
  selectMode,
  selected,
  onToggleSelect,
  onDeleted,
}: {
  products: ProductWithCategory[];
  draggable: boolean;
  /** Repli boutons (monter/descendre + déplacer vers…) — vue groupée + manuel. */
  showMoveControls?: boolean;
  categories?: Category[];
  onMoveProduct?: (id: string, dir: "up" | "down") => void;
  onMoveProductToCategory?: (id: string, categoryId: string | null) => void;
  lowStockThreshold: number;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  // Commandes boutons par carte (position dans la catégorie courante = ordre du
  // tableau `products`, qui est exactement la liste de cette catégorie).
  const moveFor = (p: ProductWithCategory, index: number): MoveControls => {
    if (
      !showMoveControls ||
      selectMode ||
      !onMoveProduct ||
      !onMoveProductToCategory
    )
      return null;
    return {
      isFirst: index === 0,
      isLast: index === products.length - 1,
      onUp: () => onMoveProduct(p.id, "up"),
      onDown: () => onMoveProduct(p.id, "down"),
      categories: categories ?? [],
      currentCategoryId: p.category_id ?? NONE,
      onMoveToCategory: (catId) => onMoveProductToCategory(p.id, catId),
    };
  };

  const cardProps = (p: ProductWithCategory, index: number) => ({
    product: p,
    lowStockThreshold,
    selectMode,
    selected: selected.has(p.id),
    onToggleSelect: () => onToggleSelect(p.id),
    onDeleted,
    moveControls: moveFor(p, index),
  });

  return (
    <div className={GRID_CLASS}>
      {products.map((p, index) =>
        draggable ? (
          <SortableProduct key={p.id} id={p.id}>
            {(handle) => (
              <ProductCard {...cardProps(p, index)} dragHandle={handle} />
            )}
          </SortableProduct>
        ) : (
          <ProductCard key={p.id} {...cardProps(p, index)} dragHandle={null} />
        )
      )}
    </div>
  );
}

/**
 * Conteneur droppable d'une catégorie (toute la section, en-tête compris) :
 * cible de dépôt pour un produit glissé depuis une autre catégorie, même quand
 * la catégorie est repliée ou vide. Désactivé hors mode glisser-produits.
 */
function DroppableCategory({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !active });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-[16px] transition-shadow",
        active && isOver && "ring-primary-400/70 ring-2"
      )}
    >
      {children}
    </div>
  );
}

function SortableProduct({
  id,
  children,
}: {
  id: string;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners })}
    </div>
  );
}

function ProductCard({
  product,
  lowStockThreshold,
  selectMode,
  selected,
  onToggleSelect,
  onDeleted,
  dragHandle,
  moveControls,
}: {
  product: ProductWithCategory;
  lowStockThreshold: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDeleted: (id: string) => void;
  dragHandle: DragHandle;
  moveControls?: MoveControls;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [available, setAvailable] = useState(product.is_available);
  // Image cassée (URL morte, ex. seed unsplash 404) → placeholder propre.
  const [imgError, setImgError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dupPending, startDup] = useTransition();
  const [delPending, startDel] = useTransition();

  const stock = stockState(product.stock_qty, lowStockThreshold);

  function onToggle() {
    const next = !available;
    setAvailable(next);
    startTransition(async () => {
      const res = await toggleProductAvailability(product.id, next);
      if (res?.error) {
        setAvailable(!next);
        toast.error(res.error);
        return;
      }
      toast.success(next ? "Produit disponible" : "Produit masqué");
    });
  }
  function onDuplicate() {
    startDup(async () => {
      const res = await duplicateProduct(product.id);
      if (res?.error || !res?.id) {
        toast.error(res?.error ?? "Échec de la duplication.");
        return;
      }
      toast.success("Produit dupliqué");
      router.push(`/catalog/${res.id}`);
    });
  }
  async function onDelete() {
    if (
      !(await confirm({
        title: `Supprimer « ${product.name_fr} » ?`,
        message: "Action irréversible.",
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startDel(async () => {
      const res = await deleteProducts([product.id]);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Produit supprimé");
      onDeleted(product.id);
    });
  }

  return (
    <div
      className={cn(
        "border-border bg-surface group relative flex flex-col overflow-hidden rounded-[16px] border shadow-sm transition-shadow hover:shadow-md",
        selected && "ring-primary-500 ring-2"
      )}
    >
      {/* Poignée de déplacement */}
      {dragHandle && (
        <button
          type="button"
          className="bg-surface/90 text-muted hover:text-foreground absolute top-2 left-2 z-10 flex size-7 cursor-grab touch-none items-center justify-center rounded-full backdrop-blur active:cursor-grabbing"
          aria-label="Déplacer le produit"
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}

      {/* Checkbox sélection */}
      {selectMode && (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          className="bg-surface/90 absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full backdrop-blur"
        >
          {selected ? (
            <CheckSquare className="text-primary-600 size-5" />
          ) : (
            <Square className="text-muted size-5" />
          )}
        </button>
      )}

      {/* Image */}
      <Link
        href={`/catalog/${product.id}`}
        className="bg-surface-3 relative block aspect-square w-full"
      >
        {product.image_url && !imgError ? (
          <Image
            src={product.image_url}
            alt={product.name_fr}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className={cn(
              "object-cover transition-opacity",
              (!available || stock === "out") && "opacity-40"
            )}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="text-subtle flex h-full w-full items-center justify-center">
            <ImageOff className="size-8" />
          </div>
        )}
        <div className="absolute bottom-2 left-2 flex flex-col gap-1">
          {!available && (
            <span className="bg-foreground/70 rounded-full px-2 py-0.5 text-[10px] font-medium text-white">
              Masqué
            </span>
          )}
          {stock === "out" && (
            <span className="bg-danger-600 rounded-full px-2 py-0.5 text-[10px] font-medium text-white">
              Épuisé
            </span>
          )}
          {stock === "low" && (
            <span className="bg-warning-500 rounded-full px-2 py-0.5 text-[10px] font-medium text-white">
              Stock bas · {product.stock_qty}
            </span>
          )}
        </div>
      </Link>

      {/* Infos */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.categories?.title && (
          <span className="text-subtle truncate text-[10px] tracking-wide uppercase">
            {product.categories.title}
          </span>
        )}
        <Link
          href={`/catalog/${product.id}`}
          className="line-clamp-2 text-sm leading-snug font-medium hover:underline"
        >
          {product.name_fr}
        </Link>
        <div className="mt-auto flex items-end justify-between pt-1">
          <div className="text-foreground text-sm font-semibold">
            {formatDA(product.price_da)}
            <span className="text-subtle ml-1 text-xs font-normal">
              / {PRODUCT_UNIT_META[product.unit].short}
            </span>
          </div>
          {stock === "ok" && (
            <span className="text-subtle text-[11px] tabular-nums">
              {product.stock_qty} en stock
            </span>
          )}
        </div>
      </div>

      {/* Repli SANS glisser : monter/descendre dans la catégorie + déplacer vers
          une autre catégorie. Commandes natives (boutons + <select>) qui
          fonctionnent sur tout WebView, même quand le glisser-déposer échoue. */}
      {moveControls && (
        <div className="border-border divide-border grid grid-cols-[2.5rem_2.5rem_1fr] divide-x border-t">
          <button
            type="button"
            onClick={moveControls.onUp}
            disabled={moveControls.isFirst}
            title="Monter"
            aria-label="Monter"
            className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-10 items-center justify-center transition-colors disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={moveControls.onDown}
            disabled={moveControls.isLast}
            title="Descendre"
            aria-label="Descendre"
            className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-10 items-center justify-center transition-colors disabled:opacity-30"
          >
            <ArrowDown className="size-4" />
          </button>
          <select
            value={moveControls.currentCategoryId}
            onChange={(e) =>
              moveControls.onMoveToCategory(
                e.target.value === NONE ? null : e.target.value
              )
            }
            title="Déplacer vers une catégorie"
            aria-label="Déplacer vers une catégorie"
            className="text-muted hover:bg-surface-2 h-10 w-full truncate bg-transparent px-2 text-xs font-medium focus:outline-none"
          >
            {moveControls.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value={NONE}>Sans catégorie</option>
          </select>
        </div>
      )}

      {/* Actions — disposées pour des zones de touche larges et espacées */}
      {/* Ligne 1 : disponibilité (toute la largeur) */}
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-pressed={available}
        className="border-border hover:bg-surface-2 flex h-11 w-full items-center gap-2 border-t px-3 text-xs font-medium transition-colors disabled:opacity-50"
      >
        <span
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            available ? "bg-success-500" : "bg-border-strong"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-4 rounded-full bg-white transition-all",
              available ? "left-4.5" : "left-0.5"
            )}
          />
        </span>
        <span className={available ? "text-success-700" : "text-muted"}>
          {available ? "Disponible" : "Masqué"}
        </span>
      </button>

      {/* Ligne 2 : dupliquer / modifier / supprimer (3 grandes cellules) */}
      <div className="border-border divide-border grid grid-cols-3 divide-x border-t">
        <button
          type="button"
          onClick={onDuplicate}
          disabled={dupPending}
          title="Dupliquer"
          className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-11 items-center justify-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <Copy className="size-4" />
          <span className="hidden lg:inline">Dupliquer</span>
        </button>
        <Link
          href={`/catalog/${product.id}`}
          title="Modifier"
          className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-11 items-center justify-center gap-1.5 text-xs font-medium transition-colors"
        >
          <Pencil className="size-4" />
          <span className="hidden lg:inline">Modifier</span>
        </Link>
        <button
          type="button"
          onClick={onDelete}
          disabled={delPending}
          title="Supprimer"
          className="text-muted hover:bg-danger-50 hover:text-danger-600 flex h-11 items-center justify-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-4" />
          <span className="hidden lg:inline">Suppr.</span>
        </button>
      </div>
    </div>
  );
}

function BulkBar({
  productCount,
  categoryCount,
  categories,
  onClear,
  onSetAvailability,
  onAssign,
  onDeleteProducts,
  onDeleteCategories,
}: {
  productCount: number;
  categoryCount: number;
  categories: Category[];
  onClear: () => void;
  onSetAvailability: (value: boolean) => void;
  onAssign: (categoryId: string) => void;
  onDeleteProducts: () => void;
  onDeleteCategories: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 lg:bottom-4 lg:left-60">
      <div className="border-border bg-surface mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-[16px] border p-3 shadow-lg">
        <span className="text-sm font-medium">
          {productCount > 0 &&
            `${productCount} produit${productCount > 1 ? "s" : ""}`}
          {productCount > 0 && categoryCount > 0 && " · "}
          {categoryCount > 0 &&
            `${categoryCount} catégorie${categoryCount > 1 ? "s" : ""}`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {productCount > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSetAvailability(true)}
              >
                Rendre dispo
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSetAvailability(false)}
              >
                Masquer
              </Button>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) onAssign(e.target.value);
                }}
                className="border-border-strong h-9 rounded-[10px] border bg-white px-2 text-xs focus:outline-none"
              >
                <option value="" disabled>
                  Assigner catégorie…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
                <option value={NONE}>Aucune catégorie</option>
              </select>
              <Button
                size="sm"
                variant="destructive"
                onClick={onDeleteProducts}
              >
                <Trash2 className="size-4" />
                Supprimer
              </Button>
            </>
          )}
          {categoryCount > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={onDeleteCategories}
            >
              <Trash2 className="size-4" />
              Supprimer {categoryCount > 1 ? "catégories" : "catégorie"}
            </Button>
          )}
          <button
            type="button"
            onClick={onClear}
            title="Annuler la sélection"
            className="text-muted hover:text-foreground p-1.5"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border bg-surface flex flex-col items-center justify-center rounded-[16px] border border-dashed py-16 text-center">
      <div className="bg-primary-50 text-primary-600 mb-4 flex size-14 items-center justify-center rounded-2xl">
        <PackageOpen className="size-7" />
      </div>
      <h2 className="text-lg font-semibold">Votre catalogue est vide</h2>
      <p className="text-muted mt-1 mb-5 max-w-sm text-sm">
        Ajoutez vos produits pour qu&apos;ils apparaissent sur votre boutique et
        que les clients puissent commander.
      </p>
      <Link href="/catalog/new" className={buttonVariants()}>
        <Package className="size-4" />
        Ajouter mon premier produit
      </Link>
    </div>
  );
}
