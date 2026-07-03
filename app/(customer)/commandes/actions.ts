"use server";

// =============================================================================
// Server Actions commandes CLIENT — annulation avant acceptation.
// =============================================================================
// L'annulation réelle (vérifs propriété + statut + paiement, re-crédit wallet)
// est faite ATOMIQUEMENT côté SQL par la RPC SECURITY DEFINER
// cancel_order_by_customer (mig 0073). Ici on relaie le résultat et on notifie
// le commerçant (push) pour qu'il ne prépare pas la commande.
//
// ROBUSTESSE : toute la fonction est encapsulée — elle ne THROW JAMAIS (sinon
// Next renvoie une "server-side exception" / digest au client). Elle renvoie
// toujours un CancelResult propre que l'UI transforme en toast.
// =============================================================================

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCustomer } from "@/lib/auth/customer";
import { notifyMerchantOrderCancelled } from "@/lib/fcm/triggers";
import type { OrderStatus } from "@/lib/types";
import type { CustomerOrderRow } from "@/components/customer/customer-orders-tabs";

export type CancelResult =
  | { ok: true; refundedToColigoPay: number }
  | { ok: false; error: string };

export async function cancelMyOrder(orderId: string): Promise<CancelResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Tu dois te reconnecter." };

    // La RPC 0073/0075 n'est pas (encore) dans database.types.ts généré : on
    // cast le NOM/args (`as never`) MAIS on garde l'appel METHODE supabase.rpc(…)
    // pour ne pas perdre le binding `this` (sinon throw à l'exécution).
    const { data, error } = await supabase.rpc(
      "cancel_order_by_customer" as never,
      { p_order_id: orderId } as never
    );

    if (error) {
      // Les RAISE de la RPC remontent un message lisible (propriété, trop tard,
      // payé en ligne…) → on l'affiche tel quel.
      const msg = (error as { message?: string }).message;
      return { ok: false, error: msg || "Annulation impossible." };
    }

    const res = (data ?? {}) as unknown as {
      ok?: boolean;
      merchant_id?: string;
      order_number?: string | null;
      customer_name?: string | null;
      refunded_to_coligo_pay?: number;
    };

    // Notifie le commerçant (push). AWAIT dans un try/catch dédié : pas de
    // promesse flottante (qui, sur Vercel, peut faire échouer l'action) et
    // aucune exception ne remonte.
    if (res.ok && res.merchant_id) {
      try {
        await notifyMerchantOrderCancelled({
          merchantId: res.merchant_id,
          orderId,
          orderRef: res.order_number ?? null,
          customerName: res.customer_name ?? null,
        });
      } catch (e) {
        console.warn("[cancelMyOrder] notify failed:", e);
      }
    }

    revalidatePath(`/commandes/${orderId}`);
    revalidatePath("/commandes");
    return {
      ok: true,
      refundedToColigoPay: Math.max(0, Number(res.refunded_to_coligo_pay ?? 0)),
    };
  } catch (e) {
    console.error("[cancelMyOrder] failed:", e);
    return {
      ok: false,
      error: "Annulation impossible pour le moment. Réessaie.",
    };
  }
}

export type ConfirmReceptionResult = { ok: boolean; error?: string };

/**
 * Le CLIENT confirme avoir bien reçu sa commande (glisser pour confirmer +
 * double confirmation côté UI). Valide la livraison au livreur via la RPC
 * SECURITY DEFINER `customer_confirm_delivery` (mig 0094) : conditions
 * anti-fraude (livreur arrivé, commande active) vérifiées côté SQL. Ne THROW
 * jamais — renvoie toujours un résultat propre.
 */
export async function confirmDeliveryReception(
  orderId: string
): Promise<ConfirmReceptionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Tu dois te reconnecter." };

    const { data, error } = await supabase.rpc(
      "customer_confirm_delivery" as never,
      { p_order_id: orderId } as never
    );
    if (error) {
      return {
        ok: false,
        error:
          (error as { message?: string }).message || "Confirmation impossible.",
      };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { ok?: boolean; reason?: string | null }
      | undefined;
    if (!row?.ok) {
      const reason = row?.reason ?? "";
      const msg =
        reason === "driver_not_arrived"
          ? "Le livreur n'a pas encore signalé son arrivée."
          : reason === "no_driver"
            ? "Aucun livreur n'est encore attribué."
            : reason === "cancelled"
              ? "Cette commande a été annulée."
              : "Confirmation impossible pour le moment.";
      return { ok: false, error: msg };
    }

    revalidatePath(`/commandes/${orderId}`);
    revalidatePath("/commandes");
    return { ok: true };
  } catch (e) {
    console.error("[confirmDeliveryReception] failed:", e);
    return {
      ok: false,
      error: "Confirmation impossible pour le moment. Réessaie.",
    };
  }
}

// =============================================================================
// « Commander à nouveau » (reorder) — recompose le panier client à partir d'une
// commande passée. order_items ne stocke qu'un SNAPSHOT (nom/prix), pas de
// product_id : on re-résout chaque nom vers le produit ACTUEL du commerçant
// (vrai id + prix du jour + disponibilité). On ajoute ceux qui existent encore
// et on signale les manquants. La lecture passe par le client RLS → le user ne
// peut résoudre que SES commandes. Ne THROW jamais.
// =============================================================================

export type ReorderItem = {
  product_id: string;
  name: string;
  unit_price_da: number;
  image_url: string | null;
  category_title: string | null;
  quantity: number;
  /** Unité de vente actuelle du produit (pilote pas/affichage du panier). */
  unit: string | null;
  min_qty: number | null;
  max_qty: number | null;
};

export type ReorderResult =
  | {
      ok: true;
      merchant: {
        id: string;
        slug: string;
        name: string;
        logo_url: string | null;
      };
      items: ReorderItem[];
      missing: string[];
    }
  | { ok: false; error: string };

export async function resolveReorder(orderId: string): Promise<ReorderResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Tu dois te reconnecter." };

    const { data: order } = await supabase
      .from("orders")
      .select(
        `merchant_id,
         merchants ( name, slug, logo_url ),
         order_items ( product_name, quantity )`
      )
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return { ok: false, error: "Commande introuvable." };

    const o = order as unknown as {
      merchant_id: string;
      merchants: {
        name: string;
        slug: string;
        logo_url: string | null;
      } | null;
      order_items: { product_name: string; quantity: number }[];
    };

    const merchant = o.merchants;
    const orderItems = o.order_items ?? [];
    if (!merchant || orderItems.length === 0) {
      return { ok: false, error: "Cette commande ne peut pas être répétée." };
    }

    // Produits ACTUELS du commerçant (lecture publique RLS) pour re-résoudre les
    // noms snapshot → product_id + prix du jour + disponibilité.
    const { data: products } = await supabase
      .from("products")
      .select(
        "id, name_fr, price_da, unit, min_qty, max_qty, image_url, category, is_available"
      )
      .eq("merchant_id", o.merchant_id);

    const byName = new Map<
      string,
      {
        id: string;
        name_fr: string;
        price_da: number;
        unit: string | null;
        min_qty: number | null;
        max_qty: number | null;
        image_url: string | null;
        category: string | null;
        is_available: boolean;
      }
    >();
    for (const p of (products ?? []) as {
      id: string;
      name_fr: string;
      price_da: number;
      unit: string | null;
      min_qty: number | null;
      max_qty: number | null;
      image_url: string | null;
      category: string | null;
      is_available: boolean;
    }[]) {
      byName.set(p.name_fr.trim().toLowerCase(), p);
    }

    const items: ReorderItem[] = [];
    const missing: string[] = [];
    for (const oi of orderItems) {
      const key = (oi.product_name ?? "").trim().toLowerCase();
      const p = byName.get(key);
      if (p && p.is_available) {
        items.push({
          product_id: p.id,
          name: p.name_fr,
          unit_price_da: p.price_da,
          image_url: p.image_url,
          category_title: p.category,
          // Quantité du snapshot, fractionnaire comprise (0.75 kg) — le store
          // panier la re-snappe au pas de l'unité ACTUELLE du produit.
          quantity: Number(oi.quantity) > 0 ? Number(oi.quantity) : 1,
          unit: p.unit,
          min_qty: p.min_qty == null ? null : Number(p.min_qty),
          max_qty: p.max_qty == null ? null : Number(p.max_qty),
        });
      } else {
        missing.push(oi.product_name);
      }
    }

    if (items.length === 0) {
      return {
        ok: false,
        error: "Aucun article de cette commande n'est plus disponible.",
      };
    }

    return {
      ok: true,
      merchant: {
        id: o.merchant_id,
        slug: merchant.slug,
        name: merchant.name,
        logo_url: merchant.logo_url,
      },
      items,
      missing,
    };
  } catch (e) {
    console.error("[resolveReorder] failed:", e);
    return {
      ok: false,
      error: "Impossible de recomposer le panier pour le moment.",
    };
  }
}

/**
 * Liste des commandes du client connecté (loader TanStack `/commandes`).
 * Réplique EXACTE de la requête SSR d'origine (mêmes colonnes, même filtre UX,
 * même règle « déjà noté » par commerçant). Ré-authentifie + RLS à chaque appel.
 *
 * ⚠️ FILTRE UX : on EXCLUT les commandes online jamais confirmées (pending /
 * failed) — tant que Chargily n'a pas confirmé le paiement, la commande n'existe
 * pas du point de vue du client.
 */
export async function fetchMyOrders(): Promise<CustomerOrderRow[]> {
  const customer = await getCurrentCustomer();
  if (!customer) return [];

  const t = await getTranslations("orders");
  const supabase = await createClient();

  const [{ data: orders }, { data: myReviews }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `id, status, payment_method, payment_status, total_da, pickup_code, order_number,
         pickup_slot_at, created_at, merchant_id, fulfillment_type,
         merchants ( name, slug, logo_url )`
      )
      .eq("customer_id", customer.id)
      .or(
        "payment_method.eq.cash,and(payment_method.eq.online,payment_status.eq.paid)"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("reviews")
      .select("merchant_id")
      .eq("customer_id", customer.id),
  ]);

  const reviewedMerchantIds = new Set(
    (myReviews ?? []).map((r) => r.merchant_id as string)
  );

  return (orders ?? []).map((o) => {
    const merchant = (
      o as unknown as {
        merchants: { name: string; logo_url: string | null } | null;
      }
    ).merchants;
    return {
      id: o.id,
      status: o.status as OrderStatus,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      total_da: o.total_da,
      pickup_code: o.pickup_code,
      order_number: o.order_number ?? null,
      created_at: o.created_at,
      fulfillment_type:
        (o.fulfillment_type as "pickup" | "delivery") ?? "pickup",
      merchant_name: merchant?.name ?? t("merchantFallback"),
      merchant_logo: merchant?.logo_url ?? null,
      reviewed: reviewedMerchantIds.has(o.merchant_id),
    };
  });
}
