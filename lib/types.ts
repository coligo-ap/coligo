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
  pickup_code: string;
  pickup_slot_at: string;
  notes: string | null;
  created_at: string;
};

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
