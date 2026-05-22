export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export const ORDER_STATUS_META: Record<
  OrderStatus,
  {
    label: string;
    tone: "amber" | "teal" | "green" | "stone" | "rose";
    kanbanColumn: -1 | 0 | 1 | 2 | 3;
  }
> = {
  pending: { label: "À confirmer", tone: "amber", kanbanColumn: 0 },
  accepted: { label: "Acceptée", tone: "teal", kanbanColumn: 1 },
  preparing: { label: "En préparation", tone: "teal", kanbanColumn: 1 },
  ready: { label: "Prête", tone: "green", kanbanColumn: 2 },
  completed: { label: "Récupérée", tone: "stone", kanbanColumn: 3 },
  cancelled: { label: "Annulée", tone: "rose", kanbanColumn: -1 },
};

/**
 * Étapes du cycle de vie d'une commande (hors annulation), dans l'ordre.
 * Sert à la timeline du détail commande.
 */
export const ORDER_FLOW: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "Confirmée" },
  { status: "accepted", label: "Acceptée" },
  { status: "preparing", label: "En préparation" },
  { status: "ready", label: "Prête" },
  { status: "completed", label: "Récupérée" },
];

/** Index de l'étape courante dans ORDER_FLOW (-1 si annulée/inconnue). */
export function orderFlowIndex(status: OrderStatus): number {
  return ORDER_FLOW.findIndex((s) => s.status === status);
}

/**
 * Action principale proposée selon le statut courant (transition « en avant »).
 * `null` quand il n'y a plus d'action directe (prête → passe par la validation
 * de retrait ; récupérée / annulée → terminal).
 */
export function nextOrderAction(
  status: OrderStatus
): { to: OrderStatus; label: string } | null {
  switch (status) {
    case "pending":
      // Accepter lance directement la préparation (pas d'étape intermédiaire).
      return { to: "preparing", label: "Accepter la commande" };
    case "accepted":
      return { to: "preparing", label: "Commencer la préparation" };
    case "preparing":
      return { to: "ready", label: "Marquer comme prête" };
    default:
      return null;
  }
}

export const KANBAN_COLUMNS = [
  { id: 0, title: "À confirmer", statuses: ["pending"] as OrderStatus[] },
  {
    id: 1,
    title: "En préparation",
    statuses: ["accepted", "preparing"] as OrderStatus[],
  },
  { id: 2, title: "Prêtes", statuses: ["ready"] as OrderStatus[] },
  { id: 3, title: "Récupérées", statuses: ["completed"] as OrderStatus[] },
] as const;

export type Merchant = {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  city: string | null;
  wilaya_code: string | null;
  is_active: boolean;
  created_at: string;
};

export type Order = {
  id: string;
  merchant_id: string;
  customer_name: string;
  customer_phone: string;
  status: OrderStatus;
  total_da: number;
  service_fee_da: number;
  cashback_da: number;
  commission_da: number;
  pickup_code: string;
  pickup_slot_at: string;
  notes: string | null;
  created_at: string;
};

export type OrderEvent = {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  client_operation_id: string | null;
  note: string | null;
  created_at: string;
};

/**
 * Transitions de statut autorisées. Toute transition hors de cette table est
 * refusée par les Server Actions (ex. pending -> completed est illégal).
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Accepter une commande la met directement en préparation.
  pending: ["preparing", "accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export type OrderItem = {
  id: string;
  order_id: string;
  product_name: string;
  unit_price_da: number;
  quantity: number;
  line_total_da: number;
};

export type OrderWithItems = Order & {
  order_items: OrderItem[];
};

// ===========================================================================
// Produits (catalogue)
// ===========================================================================
export type ProductUnit = "piece" | "kg" | "l" | "m" | "custom";

export const PRODUCT_UNIT_META: Record<
  ProductUnit,
  { label: string; short: string }
> = {
  piece: { label: "À la pièce", short: "pièce" },
  kg: { label: "Au kilo", short: "kg" },
  l: { label: "Au litre", short: "L" },
  m: { label: "Au mètre", short: "m" },
  custom: { label: "Autre / sur mesure", short: "unité" },
};

export type Category = {
  id: string;
  merchant_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  merchant_id: string;
  name_fr: string;
  name_ar: string | null;
  description_fr: string | null;
  description_ar: string | null;
  price_da: number;
  unit: ProductUnit;
  /** @deprecated remplacé par category_id (conservé pour compat). */
  category: string | null;
  category_id: string | null;
  stock_qty: number | null;
  position: number;
  image_url: string | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
};

/** Produit avec le titre de sa catégorie (jointure). */
export type ProductWithCategory = Product & {
  categories: { id: string; title: string } | null;
};

export type StockState = "untracked" | "out" | "low" | "ok";

/** État de stock d'un produit, selon stock_qty et un seuil « stock bas ». */
export function stockState(
  stockQty: number | null,
  lowThreshold: number
): StockState {
  if (stockQty === null) return "untracked";
  if (stockQty <= 0) return "out";
  if (stockQty <= lowThreshold) return "low";
  return "ok";
}
