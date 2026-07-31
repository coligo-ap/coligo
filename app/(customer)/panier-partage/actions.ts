"use server";

import { createClient } from "@/lib/supabase/server";
import { broadcastSharedCartBump } from "@/lib/realtime/broadcast";
import { CHARGILY_MIN_AMOUNT_DA } from "@/lib/config/payment-limits";
import type { CartItem, SelectedOption } from "@/lib/customer/cart-store";

/**
 * MÊME clé de ligne que `lineKeyFor` du cart-store (module "use client" — un
 * import de VALEUR ici casserait le bundle serveur, on duplique la logique
 * PURE à l'identique : signature triée groupe=option).
 */
function lineKeyFor(productId: string, options?: SelectedOption[]): string {
  if (!options || options.length === 0) return productId;
  const sig = options
    .map((o) => `${o.group_name_fr}=${o.option_name_fr}`)
    .sort()
    .join("|");
  return `${productId}#${sig}`;
}

// =============================================================================
// Actions CAPITAINE du panier partagé (session client obligatoire — la RLS
// mig 0405 ne laisse passer que le capitaine du panier). Les transitions
// d'état sont des UPDATE CONDITIONNELS (open→locked, locked→ordered…) : une
// course perdue échoue proprement au lieu d'écraser.
// =============================================================================

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Builder `from` non typé (tables mig 0405 hors database.types) — cast local. */
async function db() {
  const supabase = await createClient();
  return {
    supabase,
    from: supabase.from.bind(supabase) as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          v: string
        ) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string
        ) => {
          eq: (
            col2: string,
            val2: string
          ) => {
            is: (
              col3: string,
              val3: null
            ) => {
              select: (c: string) => {
                maybeSingle: () => Promise<{
                  data: Record<string, unknown> | null;
                  error: { message: string } | null;
                }>;
              };
            };
            select: (c: string) => {
              maybeSingle: () => Promise<{
                data: Record<string, unknown> | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
      delete: () => {
        eq: (
          col: string,
          val: string
        ) => {
          eq: (
            col2: string,
            val2: string
          ) => Promise<{ error: { message: string } | null }>;
        };
      };
    },
    rpc: supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args?: Record<string, unknown>
    ) => Promise<{
      data: unknown;
      error: { message: string } | null;
    }>,
  };
}

/** Token du panier (RLS : ne répond que pour SON panier). */
async function tokenOf(cartId: string): Promise<string | null> {
  const { from } = await db();
  const { data } = await from("shared_carts")
    .select("share_token")
    .eq("id", cartId)
    .maybeSingle();
  return (data?.share_token as string) ?? null;
}

/**
 * Crée un panier partagé à partir du panier LOCAL du capitaine (RPC
 * `shared_cart_create` : chaque ligne re-validée contre le catalogue).
 */
export async function createSharedCartFromLocal(input: {
  merchant_id: string;
  items: { product_id: string; option_ids: string[]; quantity: number }[];
}): Promise<
  { ok: true; token: string } | { ok: false; error: string; reason?: string }
> {
  const { rpc } = await db();
  const { data, error } = await rpc("shared_cart_create", {
    p_merchant_id: input.merchant_id,
    p_items: input.items,
  });
  if (error) return { ok: false, error: "Création impossible. Réessaye." };
  const res = data as { ok?: boolean; reason?: string; token?: string } | null;
  if (!res?.ok || !res.token) {
    const reasons: Record<string, string> = {
      disabled: "Le panier partagé n'est pas disponible pour le moment.",
      not_a_customer: "Connecte-toi pour inviter tes proches.",
      merchant_unavailable: "Ce commerçant n'est pas disponible.",
    };
    return {
      ok: false,
      error: reasons[res?.reason ?? ""] ?? "Création impossible.",
      reason: res?.reason,
    };
  }
  return { ok: true, token: res.token };
}

/** Dernier panier partagé encore OUVERT chez ce commerçant (pour reprendre). */
export async function getOpenSharedCart(
  merchantId: string
): Promise<{ token: string } | null> {
  const { supabase } = await db();
  // Requête typée impossible (table hors types) → cast dédié avec order/limit.
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        v: string
      ) => {
        eq: (
          col2: string,
          v2: string
        ) => {
          gt: (
            col3: string,
            v3: string
          ) => {
            order: (
              col4: string,
              o: { ascending: boolean }
            ) => {
              limit: (n: number) => Promise<{
                data: { share_token: string }[] | null;
              }>;
            };
          };
        };
      };
    };
  };
  const { data } = await from("shared_carts")
    .select("share_token")
    .eq("merchant_id", merchantId)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ? { token: data[0].share_token } : null;
}

export async function setInvitationsClosed(
  cartId: string,
  closed: boolean
): Promise<Result> {
  const { from } = await db();
  const { data, error } = await from("shared_carts")
    .update({
      invitations_closed: closed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cartId)
    .eq("status", "open")
    .select("share_token")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Action impossible." };
  void broadcastSharedCartBump(data.share_token as string);
  return { ok: true };
}

/** Verrouille (plus aucun ajout) — préalable à la commande. */
export async function lockCart(cartId: string): Promise<Result> {
  const { from } = await db();
  const { data, error } = await from("shared_carts")
    .update({ status: "locked", updated_at: new Date().toISOString() })
    .eq("id", cartId)
    .eq("status", "open")
    .select("share_token")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Verrouillage impossible." };
  void broadcastSharedCartBump(data.share_token as string);
  return { ok: true };
}

/** Rouvre un panier verrouillé NON commandé (ex : produit devenu indisponible). */
export async function unlockCart(cartId: string): Promise<Result> {
  const { from } = await db();
  const { data, error } = await from("shared_carts")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .eq("id", cartId)
    .eq("status", "locked")
    .is("order_id", null)
    .select("share_token")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Réouverture impossible." };
  void broadcastSharedCartBump(data.share_token as string);
  return { ok: true };
}

/** Adresses du client (choix livraison de la room) — RLS : les siennes. */
export async function getMyDeliveryAddresses(): Promise<
  { id: string; address_text: string; lat: number | null; lng: number | null }[]
> {
  const { supabase } = await db();
  const { data } = await supabase
    .from("customer_addresses")
    .select("id, address_text, lat, lng")
    .order("created_at", { ascending: false })
    .limit(12);
  return (
    (data as
      | {
          id: string;
          address_text: string;
          lat: number | null;
          lng: number | null;
        }[]
      | null) ?? []
  );
}

/**
 * Le PROPRIÉTAIRE fixe la récupération du panier partagé (mig 0423) :
 * retrait, ou livraison EXPRESS vers UNE de SES adresses (snapshot texte +
 * coords — create_room_order recalcule les frais serveur). RLS 0405 : seul
 * le capitaine passe. Tant que le panier n'est pas commandé.
 */
export async function setSharedCartDelivery(input: {
  /** id OU share_token du panier (wizard d'invitation = token). */
  cart_id?: string;
  token?: string;
  fulfillment: "pickup" | "delivery";
  /** Adresse ENREGISTRÉE du client (propriété vérifiée par RLS ci-dessous). */
  address_id?: string | null;
  /** OU point libre (« Ma position » / « Sur la carte ») — même UI que le
   *  checkout ; les coordonnées sont revalidées à la commande (zone + frais). */
  point?: { lat: number; lng: number; text?: string | null } | null;
}): Promise<Result> {
  if (!input.cart_id && !input.token) {
    return { ok: false, error: "Panier manquant." };
  }
  const { supabase, from } = await db();
  let patch: Record<string, unknown> = {
    fulfillment_type: "pickup",
    delivery_mode: null,
    delivery_address_id: null,
    delivery_address_text: null,
    delivery_lat: null,
    delivery_lng: null,
    updated_at: new Date().toISOString(),
  };
  if (input.fulfillment === "delivery") {
    // Point libre (position actuelle / carte) : mêmes champs qu'une adresse
    // enregistrée. Bornes de sûreté (coordonnées plausibles) ; la zone et les
    // frais restent jugés SERVEUR à la création de la commande.
    if (!input.address_id && input.point) {
      const { lat, lng } = input.point;
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return { ok: false, error: "Position invalide." };
      }
      const patchPoint = {
        ...patch,
        fulfillment_type: "delivery",
        delivery_mode: "express",
        delivery_address_id: null,
        delivery_address_text: (input.point.text ?? "").slice(0, 200) || null,
        delivery_lat: lat,
        delivery_lng: lng,
      };
      const { data: dataPoint, error: errPoint } = await (
        supabase.from("shared_carts" as never) as unknown as {
          update: (v: Record<string, unknown>) => {
            eq: (
              c: string,
              v: string
            ) => {
              is: (
                c: string,
                v: null
              ) => {
                select: (c: string) => {
                  maybeSingle: () => Promise<{
                    data: { share_token: string } | null;
                    error: { message: string } | null;
                  }>;
                };
              };
            };
          };
        }
      )
        .update(patchPoint)
        .eq(
          input.cart_id ? "id" : "share_token",
          (input.cart_id ?? input.token) as string
        )
        .is("order_id", null)
        .select("share_token")
        .maybeSingle();
      if (errPoint || !dataPoint) {
        return {
          ok: false,
          error: "Modification impossible (déjà commandé ?).",
        };
      }
      void broadcastSharedCartBump(dataPoint.share_token);
      return { ok: true };
    }
    if (!input.address_id) {
      return { ok: false, error: "Choisis une adresse de livraison." };
    }
    const { data: addr } = await supabase
      .from("customer_addresses")
      .select("id, address_text, lat, lng")
      .eq("id", input.address_id)
      .maybeSingle();
    const a = addr as {
      id: string;
      address_text: string;
      lat: number | null;
      lng: number | null;
    } | null;
    if (!a || a.lat == null || a.lng == null) {
      return { ok: false, error: "Adresse introuvable ou sans position." };
    }
    patch = {
      ...patch,
      fulfillment_type: "delivery",
      delivery_mode: "express",
      delivery_address_id: a.id,
      delivery_address_text: a.address_text,
      delivery_lat: a.lat,
      delivery_lng: a.lng,
    };
  }
  // Cast local (chaîne update→eq→is hors du builder générique de db()).
  const { data, error } = await (
    supabase.from("shared_carts" as never) as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string
        ) => {
          is: (
            c: string,
            v: null
          ) => {
            select: (c: string) => {
              maybeSingle: () => Promise<{
                data: { share_token: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    }
  )
    .update(patch)
    .eq(
      input.cart_id ? "id" : "share_token",
      (input.cart_id ?? input.token) as string
    )
    .is("order_id", null)
    .select("share_token")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: "Modification impossible (déjà commandé ?)." };
  }
  void broadcastSharedCartBump(data.share_token);
  return { ok: true };
}

/**
 * Config de RÉCUPÉRATION du panier partagé (mig 0423) pour PRÉ-REMPLIR le
 * checkout du propriétaire : ce qu'il a choisi en invitant la famille doit se
 * retrouver tel quel à l'étape paiement — même logique, mêmes règles, zéro
 * ressaisie. RLS : seul le capitaine lit son panier.
 */
export async function getSharedCartDelivery(cartId: string): Promise<{
  fulfillment_type: "pickup" | "delivery";
  delivery_mode: "express" | null;
  delivery_address_id: string | null;
  delivery_address_text: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
} | null> {
  const { supabase } = await db();
  const { data } = await (
    supabase.from("shared_carts" as never) as unknown as {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          maybeSingle: () => Promise<{
            data: {
              fulfillment_type: "pickup" | "delivery";
              delivery_mode: "express" | null;
              delivery_address_id: string | null;
              delivery_address_text: string | null;
              delivery_lat: number | null;
              delivery_lng: number | null;
            } | null;
          }>;
        };
      };
    }
  )
    .select(
      "fulfillment_type, delivery_mode, delivery_address_id, delivery_address_text, delivery_lat, delivery_lng"
    )
    .eq("id", cartId)
    .maybeSingle();
  return data ?? null;
}

export async function cancelCart(cartId: string): Promise<Result> {
  const { from } = await db();
  // Deux tentatives conditionnelles (open puis locked) — jamais un panier
  // déjà commandé.
  let res = await from("shared_carts")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", cartId)
    .eq("status", "open")
    .select("share_token")
    .maybeSingle();
  if (!res.data) {
    res = await from("shared_carts")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", cartId)
      .eq("status", "locked")
      .is("order_id", null)
      .select("share_token")
      .maybeSingle();
  }
  if (res.error || !res.data)
    return { ok: false, error: "Annulation impossible." };
  void broadcastSharedCartBump(res.data.share_token as string);
  return { ok: true };
}

/** Le capitaine retire N'IMPORTE quelle ligne (règle métier). */
export async function captainRemoveItem(
  cartId: string,
  itemId: string
): Promise<Result> {
  const { from } = await db();
  const token = await tokenOf(cartId);
  if (!token) return { ok: false, error: "Panier introuvable." };
  const { error } = await from("shared_cart_items")
    .delete()
    .eq("id", itemId)
    .eq("cart_id", cartId);
  if (error) return { ok: false, error: "Suppression impossible." };
  void broadcastSharedCartBump(token);
  return { ok: true };
}

/**
 * Reconstruit des `CartItem` COMPLETS pour hydrater le panier local du
 * capitaine → checkout classique inchangé (prix recalculés par createOrder).
 * Les lignes dont le produit n'est plus disponible sont écartées (signalées).
 */
export async function getCartForCheckout(cartId: string): Promise<
  Result<{
    token: string;
    merchant: {
      id: string;
      slug: string;
      name: string;
      logo_url: string | null;
    };
    items: CartItem[];
    skipped: number;
  }>
> {
  const token = await tokenOf(cartId);
  if (!token) return { ok: false, error: "Panier introuvable." };

  const { rpc } = await db();
  const { data, error } = await rpc("shared_cart_by_token", { p_token: token });
  if (error || !data) return { ok: false, error: "Lecture impossible." };

  const view = data as {
    merchant: {
      id: string;
      slug: string;
      name: string;
      logo_url: string | null;
    } | null;
    items: {
      product_id: string;
      name_fr: string;
      name_ar: string | null;
      image_url: string | null;
      unit: string | null;
      min_qty: number | null;
      max_qty: number | null;
      quantity: number;
      unit_price_da: number;
      available: boolean;
      options: {
        option_id: string;
        group_fr: string;
        group_ar: string | null;
        name_fr: string;
        name_ar: string | null;
        delta_da: number;
      }[];
    }[];
  };
  if (!view.merchant) return { ok: false, error: "Commerçant indisponible." };

  // Fusion par line_key CLIENT (mêmes règles que le panier local) : les lignes
  // identiques de plusieurs participants deviennent UNE ligne de commande.
  const byKey = new Map<string, CartItem>();
  let skipped = 0;
  for (const it of view.items) {
    if (!it.available) {
      skipped++;
      continue;
    }
    const options: SelectedOption[] = it.options.map((o) => ({
      option_id: o.option_id,
      group_id: "",
      group_name_fr: o.group_fr,
      group_name_ar: o.group_ar,
      option_name_fr: o.name_fr,
      option_name_ar: o.name_ar,
      price_delta_da: o.delta_da,
    }));
    const key = lineKeyFor(it.product_id, options.length ? options : undefined);
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity =
        Math.round((existing.quantity + it.quantity) * 100) / 100;
    } else {
      byKey.set(key, {
        product_id: it.product_id,
        line_key: key,
        name: it.name_fr,
        name_ar: it.name_ar,
        unit_price_da: it.unit_price_da,
        quantity: it.quantity,
        unit: it.unit,
        min_qty: it.min_qty,
        max_qty: it.max_qty,
        image_url: it.image_url,
        options: options.length ? options : undefined,
      });
    }
  }

  return {
    ok: true,
    token,
    merchant: view.merchant,
    items: [...byKey.values()],
    skipped,
  };
}

/**
 * « Faire payer un proche » : (ré)génère le payment_token du panier COMMANDÉ.
 * Le lien /payer/{ptoken} est une capacité DISTINCTE du share_token — on peut
 * l'envoyer à une seule personne sans exposer la room. Idempotent : un token
 * déjà posé est simplement renvoyé (le lien reste stable).
 */
export async function createGuestPaymentLink(
  cartId: string
): Promise<
  | { ok: true; ptoken: string; shareToken: string }
  | { ok: false; error: string }
> {
  const { supabase, from } = await db();

  const { data: cart } = await from("shared_carts")
    .select("share_token, payment_token, order_id, status")
    .eq("id", cartId)
    .maybeSingle();
  if (!cart) return { ok: false, error: "Panier introuvable." };
  if (cart.status !== "ordered" || !cart.order_id) {
    return { ok: false, error: "Commande d'abord, puis envoie le lien." };
  }

  // La commande liée doit être online, impayée, au-dessus du minimum Chargily.
  const { data: order } = await supabase
    .from("orders")
    .select("id, payment_method, payment_status, total_da")
    .eq("id", cart.order_id as string)
    .maybeSingle();
  if (!order) return { ok: false, error: "Commande introuvable." };
  if (order.payment_method !== "online") {
    return { ok: false, error: "Cette commande est réglée en espèces." };
  }
  if (order.payment_status === "paid") {
    return { ok: false, error: "Cette commande est déjà payée." };
  }
  if (order.total_da < CHARGILY_MIN_AMOUNT_DA) {
    return {
      ok: false,
      error: `Le paiement en ligne nécessite un minimum de ${CHARGILY_MIN_AMOUNT_DA} DA.`,
    };
  }

  if (cart.payment_token) {
    return {
      ok: true,
      ptoken: cart.payment_token as string,
      shareToken: cart.share_token as string,
    };
  }

  const ptoken = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const { data: updated } = await from("shared_carts")
    .update({
      payment_token: ptoken,
      payment_token_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", cartId)
    .eq("status", "ordered")
    .is("payment_token", null)
    .select("share_token")
    .maybeSingle();
  if (updated) {
    return { ok: true, ptoken, shareToken: updated.share_token as string };
  }

  // Course perdue : un autre onglet vient de poser le token → on le relit.
  const { data: again } = await from("shared_carts")
    .select("share_token, payment_token")
    .eq("id", cartId)
    .maybeSingle();
  if (again?.payment_token) {
    return {
      ok: true,
      ptoken: again.payment_token as string,
      shareToken: again.share_token as string,
    };
  }
  return { ok: false, error: "Génération du lien impossible. Réessaye." };
}

/**
 * GARDE ANTI-DOUBLON du checkout partagé : à appeler AVANT createOrder.
 * Un panier déjà commandé (ordered / order_id posé) ne doit JAMAIS produire
 * une deuxième commande — cas vécu : le capitaine abandonne le checkout,
 * revient sur la room verrouillée et re-clique « Commander ».
 */
export async function assertSharedCartOrderable(
  cartId: string
): Promise<Result> {
  const { from } = await db();
  const { data } = await from("shared_carts")
    .select("status, order_id")
    .eq("id", cartId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Panier introuvable." };
  if (data.order_id || data.status === "ordered") {
    return {
      ok: false,
      error:
        "Ce panier a déjà une commande — retrouve-la dans « Mes commandes ».",
    };
  }
  if (data.status !== "open" && data.status !== "locked") {
    return { ok: false, error: "Ce panier n'est plus actif." };
  }
  return { ok: true };
}

/** Lie la commande créée au panier (locked → ordered). Conditionnel strict. */
export async function attachOrderToSharedCart(
  cartId: string,
  orderId: string
): Promise<Result> {
  const { supabase, from } = await db();
  // La commande doit être À MOI (RLS orders : select own).
  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "Commande introuvable." };

  const { data, error } = await from("shared_carts")
    .update({
      order_id: orderId,
      status: "ordered",
      updated_at: new Date().toISOString(),
    })
    .eq("id", cartId)
    .eq("status", "locked")
    .is("order_id", null)
    .select("share_token")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Panier déjà commandé." };
  void broadcastSharedCartBump(data.share_token as string);
  return { ok: true };
}
