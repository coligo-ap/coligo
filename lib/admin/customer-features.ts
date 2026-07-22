// =============================================================================
// Espace CLIENTS — TYPES & LIBELLÉS PARTAGÉS (module PUR).
//
// Ce fichier ne doit JAMAIS importer de code serveur (`next/headers`, client
// Supabase serveur…) : il est consommé par des composants « use client ».
// La couche données (lib/data/admin-customers.ts) s'appuie dessus ; l'inverse
// ferait entrer tout le serveur dans le bundle client (erreur de compilation).
// =============================================================================

/**
 * Fonctionnalités coupables client par client. Sous-ensemble des clés de
 * `feature_flags` (lib/data/feature-flags.ts) — volontairement recopié ici pour
 * garder ce module pur ; toute nouvelle clé doit exister des DEUX côtés ET dans
 * la contrainte CHECK de `customer_feature_blocks` (mig 0397).
 */
export const CUSTOMER_FEATURES = [
  "coligo_pay",
  "cashback",
  "online_payment",
  "drive",
  "express",
  "tour",
  "barcode_marketplace",
  "identity_verification",
] as const;

export type CustomerFeature = (typeof CUSTOMER_FEATURES)[number];

export const CUSTOMER_FEATURE_LABEL: Record<
  CustomerFeature,
  { label: string; help: string }
> = {
  coligo_pay: {
    label: "Coligo Pay",
    help: "Paiement QR chez un commerçant et transferts entre clients.",
  },
  cashback: {
    label: "Cashback",
    help: "Gains cashback sur les commandes (le client peut toujours commander).",
  },
  online_payment: {
    label: "Paiement en ligne",
    help: "Règlement par carte ; le paiement à la livraison reste possible.",
  },
  drive: { label: "Coligo Drive", help: "Demande de course VTC." },
  express: {
    label: "Livraison Express",
    help: "Commande en livraison Express.",
  },
  tour: {
    label: "Livraison en tournée",
    help: "Commande en tournée programmée.",
  },
  barcode_marketplace: {
    label: "Scan code-barres",
    help: "Recherche de produit par scan dans la marketplace.",
  },
  identity_verification: {
    label: "Vérification d'identité",
    help: "Parcours de vérification d'identité (IDV).",
  },
};

export function isCustomerFeature(v: string): v is CustomerFeature {
  return (CUSTOMER_FEATURES as readonly string[]).includes(v);
}

export type CustomerStatusFilter =
  | "all"
  | "active"
  | "blocked"
  | "restricted"
  | "cod_blocked";

export const CUSTOMERS_PAGE_SIZE = 25;

export type CustomerRow = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  pay_handle: string | null;
  created_at: string;
  wilaya_code: string | null;
  commune: string | null;
  is_blocked: boolean;
  blocked_at: string | null;
  blocked_reason: string | null;
  cod_blocked: boolean;
  noshow_count: number;
  rating_avg: number;
  rating_count: number;
  blocked_features: string[];
  orders_count: number;
  orders_completed: number;
  spend_da: number;
  rides_count: number;
  cashback_balance_da: number;
  topup_balance_da: number;
  last_seen_at: string | null;
  last_city: string | null;
  last_country: string | null;
  last_lat: number | null;
  last_lng: number | null;
};

export type CustomersPage = {
  rows: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type CustomerLocation = {
  kind: "device" | "address" | "delivery" | "ride";
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  seen_at: string | null;
  detail: string | null;
};

export type CustomerOrderRow = {
  id: string;
  order_number: number | null;
  status: string;
  total_da: number;
  payment_method: string;
  fulfillment_type: string | null;
  delivery_mode: string | null;
  created_at: string;
  merchant_name: string | null;
};

export type CustomerDevice = {
  ip: string;
  platform: string | null;
  city: string | null;
  country: string | null;
  last_seen_at: string;
  hits: number;
};

export type CustomerDetail = {
  customer: CustomerRow & {
    admin_note: string | null;
    blocked_by: string | null;
    is_female_verified: boolean;
    noshow_pending: boolean;
  };
  features: { feature: string; reason: string | null; created_at: string }[];
  orders: CustomerOrderRow[];
  devices: CustomerDevice[];
  locations: CustomerLocation[];
};
