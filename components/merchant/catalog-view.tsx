"use client";

import Link from "next/link";
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
  arrayMove,
} from "@dnd-kit/sortable";
import { Plus, Search, CheckSquare, Square, GripVertical } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { cn } from "@/lib/utils";
import { type Category, type ProductWithCategory } from "@/lib/types";
import {
  deleteProducts,
  reorderProducts,
  bulkSetAvailability,
  bulkAssignCategory,
} from "@/app/(merchant)/catalog/actions";
import {
  reorderCategories,
  deleteCategories,
  quickCreateCategory,
} from "@/app/(merchant)/catalog/categories/actions";
import { ALL, NONE } from "./catalog-shared";
import { ToolsMenu, BulkBar, EmptyState } from "./catalog-toolbar";
import {
  CategoryChip,
  SortableCategory,
  CategorySection,
} from "./catalog-categories";
import { ProductItems, DroppableCategory } from "./catalog-products";

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
  const [note, setNote] = useActionNote();

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
          setNote({ ok: false, text: res.error });
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
          setNote({ ok: false, text: r1.error });
          return;
        }
      }
      const r2 = await reorderProducts(destIds);
      if (r2?.error) {
        setNote({ ok: false, text: r2.error });
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
        setNote({ ok: false, text: res.error });
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
        setNote({ ok: false, text: r1.error });
        return;
      }
      const r2 = await reorderProducts(destIds);
      if (r2?.error) {
        setNote({ ok: false, text: r2.error });
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
        setNote({ ok: false, text: res.error });
        return;
      }
      setNote({
        ok: true,
        text: `${ids.length} produit${ids.length > 1 ? "s" : ""} supprimé${ids.length > 1 ? "s" : ""}`,
      });
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
        setNote({ ok: false, text: res.error });
        return;
      }
      setNote({
        ok: true,
        text: `${ids.length} catégorie${ids.length > 1 ? "s" : ""} supprimée${ids.length > 1 ? "s" : ""}`,
      });
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
        setNote({ ok: false, text: res.error });
        return;
      }
      setNote({ ok: true, text: successMsg });
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
        setNote({ ok: false, text: res.error ?? "Échec de la création." });
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
      // Succès : la catégorie apparaît dans la liste (setCats) = feedback visuel.
      refresh();
    });
  }

  // Photo de catégorie : reflet local immédiat après ajout/remplacement/retrait.
  function updateCategoryImageLocal(id: string, url: string | null) {
    setCats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, image_url: url } : c))
    );
  }
  // Nom de catégorie : reflet local immédiat après renommage (feuille d'édition).
  function updateCategoryTitleLocal(id: string, title: string) {
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }
  const uploadMerchantId =
    cats[0]?.merchant_id ?? products[0]?.merchant_id ?? "";

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

      {/* Retour d'action inline (erreurs / résultats de suppression en masse…) —
          remplace les toasts (règle produit). Auto-effacé. */}
      <ActionNote note={note} className="mb-3 text-[13px]" />

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
                            addHref={
                              g.key !== NONE
                                ? `/catalog/new?category=${g.key}`
                                : "/catalog/new"
                            }
                            selectMode={selectMode}
                            selectable={g.key !== NONE}
                            selected={selCats.has(g.key)}
                            onToggleSelect={() => toggleSelCat(g.key)}
                            edit={
                              g.key !== NONE && !selectMode
                                ? {
                                    categoryId: g.key,
                                    merchantId: uploadMerchantId,
                                    onRenamed: (t) => {
                                      updateCategoryTitleLocal(g.key, t);
                                      refresh();
                                    },
                                    onImageChanged: (url) => {
                                      updateCategoryImageLocal(g.key, url);
                                      refresh();
                                    },
                                    onDeleted: () => {
                                      removeCategoriesLocal([g.key]);
                                      refresh();
                                    },
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
