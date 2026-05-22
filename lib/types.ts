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
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  commission_rate_applied: number | null;
  cashback_rate_applied: number | null;
  chargily_fee_rate_applied: number | null;
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

// ===========================================================================
// Promotions
// ===========================================================================
export type PromotionType =
  | "product_discount"
  | "promo_code"
  | "quantity_offer";

export type PromotionStatus = "scheduled" | "active" | "expired" | "disabled";

export type DiscountKind = "percent" | "amount";

export const PROMOTION_TYPE_META: Record<
  PromotionType,
  { label: string; short: string; description: string }
> = {
  product_discount: {
    label: "Réduction produit",
    short: "Réduction",
    description: "-X % ou -X DA sur un ou plusieurs produits choisis.",
  },
  promo_code: {
    label: "Code promo",
    short: "Code",
    description:
      "Un code saisi au paiement, qui réduit le total de la commande.",
  },
  quantity_offer: {
    label: "Offre quantité",
    short: "Offre",
    description: "« X achetés = Y offert(s) » sur un produit (ex. 2 = 1).",
  },
};

export const PROMOTION_STATUS_META: Record<
  PromotionStatus,
  { label: string; tone: "success" | "primary" | "neutral" | "warning" }
> = {
  active: { label: "Active", tone: "success" },
  scheduled: { label: "Programmée", tone: "primary" },
  expired: { label: "Expirée", tone: "neutral" },
  disabled: { label: "Désactivée", tone: "warning" },
};

export type Promotion = {
  id: string;
  merchant_id: string;
  type: PromotionType;
  title_fr: string;
  title_ar: string | null;
  status: PromotionStatus;
  discount_kind: DiscountKind | null;
  discount_value: number | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  uses_count: number;
  created_at: string;
};

/** Promotion + ids des produits liés (pour product_discount / quantity_offer). */
export type PromotionWithProducts = Promotion & {
  promotion_products: { product_id: string }[];
};

// ===========================================================================
// Wallet commerçant (finances)
// ===========================================================================
export type WalletEntryType = "sale" | "commission" | "payout" | "adjustment";

export type PayoutStatus = "pending" | "approved" | "paid" | "rejected";

export const WALLET_ENTRY_META: Record<
  WalletEntryType,
  { label: string; tone: "success" | "danger" | "primary" | "neutral" }
> = {
  sale: { label: "Vente", tone: "success" },
  commission: { label: "Commission Coligo", tone: "danger" },
  payout: { label: "Versement", tone: "primary" },
  adjustment: { label: "Ajustement", tone: "neutral" },
};

export const PAYOUT_STATUS_META: Record<
  PayoutStatus,
  { label: string; tone: "warning" | "primary" | "success" | "danger" }
> = {
  pending: { label: "En attente", tone: "warning" },
  approved: { label: "Approuvée", tone: "primary" },
  paid: { label: "Versée", tone: "success" },
  rejected: { label: "Refusée", tone: "danger" },
};

/** Méthodes de versement proposées (MVP, texte libre côté base). */
export const PAYOUT_METHODS: { value: string; label: string }[] = [
  { value: "ccp", label: "CCP" },
  { value: "baridimob", label: "BaridiMob" },
  { value: "bank", label: "Virement bancaire" },
];

export type WalletEntry = {
  id: string;
  merchant_id: string;
  order_id: string | null;
  type: WalletEntryType;
  amount_da: number;
  commission_rate: number | null;
  note: string | null;
  created_at: string;
};

export type PayoutRequest = {
  id: string;
  merchant_id: string;
  amount_da: number;
  status: PayoutStatus;
  method: string;
  details: string | null;
  processed_at: string | null;
  created_at: string;
};

/** Une demande « réserve » des fonds tant qu'elle n'est ni payée ni refusée. */
export function isPayoutReserving(status: PayoutStatus): boolean {
  return status === "pending" || status === "approved";
}

// ===========================================================================
// Modes de paiement & taux configurables (cash / online)
// ===========================================================================
export type PaymentMethod = "cash" | "online";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export const PAYMENT_METHOD_META: Record<
  PaymentMethod,
  { label: string; short: string; tone: "neutral" | "primary" }
> = {
  cash: { label: "Espèces", short: "Cash", tone: "neutral" },
  online: { label: "En ligne", short: "En ligne", tone: "primary" },
};

/** Taux globaux de la plateforme (ligne unique de platform_settings). */
export type PlatformSettings = {
  commission_cash: number;
  commission_online: number;
  cashback_online: number;
  cashback_cash: number;
  chargily_fee: number;
  max_debt_da: number;
  updated_at: string;
};

/** Surcharges de taux par commerçant (NULL = hérite du global). */
export type MerchantRateOverrides = {
  commission_cash: number | null;
  commission_online: number | null;
  cashback_online: number | null;
  cashback_cash: number | null;
};

export type RateKey =
  | "commission_cash"
  | "commission_online"
  | "cashback_online"
  | "cashback_cash"
  | "chargily_fee";
