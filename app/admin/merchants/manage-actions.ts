"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Hub Commerçants — CORRECTION COMPLÈTE d'une fiche par l'équipe Coligo
 * (mig 0430). Sert à dépanner un commerçant qui n'y arrive pas seul : mauvais
 * logo, adresse fausse, horaires oubliés, rayon de livraison absurde…
 *
 * ⚠️ Appel avec la SESSION de l'administrateur (jamais `createAdminClient`) :
 * la RPC vérifie `admin_can('commercants')` sur le JWT de l'appelant. En
 * service_role, ce JWT n'existe pas — la garde ne voudrait plus rien dire et
 * n'importe quel chemin serveur pourrait tout écrire.
 *
 * La RPC applique une LISTE BLANCHE : ce qui n'y figure pas est ignoré. Les
 * taux et l'approbation gardent donc leurs écrans dédiés, avec leurs propres
 * garde-fous. Chaque modification est journalisée (qui, quoi, avant/après).
 */

export type ManageState = { ok?: boolean; error?: string };

/** Champs que l'écran d'administration peut soumettre. Tous OPTIONNELS : on
 *  n'envoie que ce qui a réellement changé — une clé absente ne touche à rien. */
export type MerchantPatch = Partial<{
  name: string;
  slug: string;
  category: string | null;
  description_fr: string | null;
  description_ar: string | null;
  logo_url: string | null;
  cover_url: string | null;
  phone_public: string | null;
  manager_name: string | null;
  address: string | null;
  commune: string | null;
  city: string | null;
  wilaya_code: string | null;
  latitude: number | null;
  longitude: number | null;
  prep_time_min: number | null;
  min_order_da: number | null;
  delivery_enabled: boolean;
  express_enabled: boolean;
  tours_enabled: boolean;
  delivery_radius_km: number | null;
  accepts_cash: boolean;
  accepts_online: boolean;
  is_active: boolean;
  is_frozen: boolean;
  orders_paused: boolean;
  auto_accept_orders: boolean;
  catalog_display: string | null;
  print_lang: string | null;
}>;

export async function adminUpdateMerchant(
  merchantId: string,
  patch: MerchantPatch
): Promise<ManageState> {
  if (!merchantId) return { error: "Commerçant manquant." };
  // Rien à écrire : on ne dérange pas la base pour un formulaire ouvert puis
  // refermé sans modification.
  if (!patch || Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("admin_update_merchant", {
    p_id: merchantId,
    p_patch: patch,
  });
  if (error) return { error: error.message };

  // La fiche publique du commerçant et les écrans d'administration reflètent
  // le changement tout de suite.
  revalidatePath("/admin/merchants");
  revalidatePath("/m/[slug]", "page");
  return { ok: true };
}

/**
 * Fiche COMPLÈTE d'un commerçant, chargée à l'ouverture du panneau d'édition.
 *
 * On ne la met pas dans l'annuaire : celui-ci est paginé et volontairement
 * léger (mig 0429). Ici c'est UNE ligne, à la demande — afficher un formulaire
 * avec des champs vides alors que la base a des valeurs serait pire que lent :
 * l'administrateur croirait que la donnée n'existe pas.
 */
export async function getMerchantFullForAdmin(
  merchantId: string
): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
    };
  };
  const { data } = await from("merchants")
    .select(
      "id, name, slug, category, description_fr, description_ar, logo_url, cover_url, phone_public, manager_name, address, commune, city, wilaya_code, latitude, longitude, prep_time_min, min_order_da, delivery_enabled, express_enabled, tours_enabled, delivery_radius_km, accepts_cash, accepts_online, is_active, is_frozen, orders_paused, auto_accept_orders, catalog_display, print_lang"
    )
    .eq("id", merchantId)
    .maybeSingle();
  return data ?? null;
}
