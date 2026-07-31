"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastSharedCartBump } from "@/lib/realtime/broadcast";
import {
  notifySharedCartOrderPlaced,
  notifySharedCartPayRequest,
} from "@/lib/fcm/triggers";
import {
  createRoomOrder,
  type RoomOrderResult,
} from "@/lib/shared-cart/room-order";

// =============================================================================
// Actions INVITÉ du panier partagé — publiques (aucune session requise) : la
// sécurité est ENTIÈREMENT dans les RPC (mig 0405) qui revalident share_token +
// guest_token à chaque appel. Chaque mutation réussie émet un bump temps réel.
// Le capitaine passe aussi par ici depuis la room (guest_token null → la RPC le
// reconnaît via sa session).
// =============================================================================

export type GuestActionResult = {
  ok: boolean;
  reason?: string;
  member?: {
    id: string;
    display_name: string | null;
    member_number: number;
    color_index: number;
  };
};

async function callRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<GuestActionResult> {
  try {
    const supabase = await createClient();
    // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{
      data: GuestActionResult | null;
      error: { message: string } | null;
    }>;
    const { data, error } = await rpc(fn, args);
    if (error) return { ok: false, reason: "error" };
    return data ?? { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function guestJoin(input: {
  token: string;
  guestToken: string;
  name?: string | null;
}): Promise<GuestActionResult> {
  const res = await callRpc("shared_cart_join", {
    p_token: input.token,
    p_guest_token: input.guestToken,
    p_display_name: input.name ?? null,
  });
  if (res.ok) void broadcastSharedCartBump(input.token);
  return res;
}

export async function guestAddItem(input: {
  token: string;
  guestToken: string | null;
  productId: string;
  optionIds: string[];
  quantity: number;
}): Promise<GuestActionResult> {
  const res = await callRpc("shared_cart_add_item", {
    p_token: input.token,
    p_guest_token: input.guestToken,
    p_product_id: input.productId,
    p_option_ids: input.optionIds,
    p_quantity: input.quantity,
  });
  if (res.ok) void broadcastSharedCartBump(input.token);
  return res;
}

export async function guestSetQty(input: {
  token: string;
  guestToken: string | null;
  itemId: string;
  quantity: number;
}): Promise<GuestActionResult> {
  const res = await callRpc("shared_cart_set_qty", {
    p_token: input.token,
    p_guest_token: input.guestToken,
    p_item_id: input.itemId,
    p_quantity: input.quantity,
  });
  if (res.ok) void broadcastSharedCartBump(input.token);
  return res;
}

/**
 * « LE PREMIER QUI PAIE, PAIE » : un membre du groupe tape « Payer » — on crée
 * la commande NOUS-MÊMES (compte du capitaine, retrait, en ligne — mêmes
 * règles d'argent que le checkout, cf. lib/shared-cart/room-order) et on
 * renvoie le lien /payer. Public : le token du lien EST la capacité, tout est
 * revalidé serveur. Le capitaine est prévenu par push + bump temps réel.
 */
export async function guestOrderAndPay(input: {
  token: string;
  /** Identité invité (localStorage) — le capitaine connecté passe null. */
  guestToken?: string | null;
}): Promise<RoomOrderResult> {
  // GARDE ANTI-ABUS (mig 0424, audit 31/07) : le simple porteur du lien ne
  // peut plus geler le panier en boucle — il faut être MEMBRE, et une seule
  // tentative par 10 min. La RPC est SECURITY DEFINER (REVOKE public).
  const guard = createAdminClient();
  const rpc = guard.rpc.bind(guard) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: string | null }>;
  const { data: verdict } = await rpc("shared_cart_can_room_order", {
    p_token: input.token,
    p_guest_token: input.guestToken ?? null,
  });
  if (verdict === "not_member") {
    return {
      ok: false,
      reason: "not_member",
      message: "Rejoins le panier pour pouvoir régler la commande.",
    };
  }
  if (verdict === "too_soon") {
    return {
      ok: false,
      reason: "too_soon",
      message: "Une demande vient d'être lancée — réessaie dans un instant.",
    };
  }

  const res = await createRoomOrder(input.token);
  if (res.ok) {
    void broadcastSharedCartBump(input.token);
    try {
      const admin = createAdminClient();
      const from = admin.from.bind(admin) as unknown as (t: string) => {
        select: (c: string) => {
          eq: (
            col: string,
            v: string
          ) => {
            maybeSingle: () => Promise<{
              data: {
                captain_customer_id: string;
                merchant_id: string;
              } | null;
            }>;
          };
        };
      };
      const { data: cart } = await from("shared_carts")
        .select("captain_customer_id, merchant_id")
        .eq("share_token", input.token)
        .maybeSingle();
      if (cart) {
        const { data: m } = await admin
          .from("merchants")
          .select("name")
          .eq("id", cart.merchant_id)
          .maybeSingle();
        void notifySharedCartOrderPlaced({
          customerId: cart.captain_customer_id,
          merchantName: m?.name ?? "Coligo",
          shareToken: input.token,
        });
      }
    } catch (e) {
      console.warn("[shared-cart] order placed push:", e);
    }
  }
  return res;
}

/**
 * « Payer » tapé alors que la commande n'est pas encore validée : prévient le
 * CAPITAINE (push, rate-limité 10 min côté SQL). Public — le token du lien
 * est la capacité, la RPC revalide tout.
 */
export async function guestRequestPayment(input: {
  token: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const res = await callRpc("shared_cart_request_payment", {
    p_token: input.token,
  });
  const r = res as unknown as {
    ok: boolean;
    reason?: string;
    notified?: boolean;
    captain_customer_id?: string;
  };
  if (r.ok && r.notified && r.captain_customer_id) {
    try {
      const admin = createAdminClient();
      const from = admin.from.bind(admin) as unknown as (t: string) => {
        select: (c: string) => {
          eq: (
            col: string,
            v: string
          ) => {
            maybeSingle: () => Promise<{
              data: { merchant_id: string } | null;
            }>;
          };
        };
      };
      const { data: cart } = await from("shared_carts")
        .select("merchant_id")
        .eq("share_token", input.token)
        .maybeSingle();
      let merchantName = "Coligo";
      if (cart?.merchant_id) {
        const { data: m } = await admin
          .from("merchants")
          .select("name")
          .eq("id", cart.merchant_id)
          .maybeSingle();
        if (m?.name) merchantName = m.name;
      }
      void notifySharedCartPayRequest({
        customerId: r.captain_customer_id,
        merchantName,
        shareToken: input.token,
      });
    } catch (e) {
      console.warn("[shared-cart] pay request push:", e);
    }
  }
  return { ok: r.ok, reason: r.reason };
}

export async function guestSetName(input: {
  token: string;
  guestToken: string;
  name: string;
}): Promise<GuestActionResult> {
  const res = await callRpc("shared_cart_set_name", {
    p_token: input.token,
    p_guest_token: input.guestToken,
    p_name: input.name,
  });
  if (res.ok) void broadcastSharedCartBump(input.token);
  return res;
}
