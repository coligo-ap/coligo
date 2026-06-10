/**
 * Auth CHAUFFEUR VTC — population SÉPARÉE des livreurs. Email synthétique dérivé
 * du téléphone, domaine DISTINCT pour l'isolation des rôles (middleware) :
 *   "+213612345678" → "213612345678@chauffeurs.coligo.local"
 */

import { createClient } from "@/lib/supabase/server";

export const CHAUFFEUR_DOMAIN = "chauffeurs.coligo.local";

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) throw new Error("phone_empty");
  return digits;
}

export function phoneToChauffeurEmail(rawPhone: string): string {
  return `${normalizePhone(rawPhone)}@${CHAUFFEUR_DOMAIN}`;
}

export type CurrentChauffeur = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  is_verified: boolean;
  is_frozen: boolean;
  is_blocked: boolean;
  vehicle_plate: string | null;
};

/** Le chauffeur lié au user courant ; null si pas un chauffeur. */
export async function getCurrentChauffeur(): Promise<CurrentChauffeur | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("chauffeurs")
    .select(
      "id, user_id, full_name, phone, is_verified, is_frozen, is_blocked, vehicle_plate"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    user_id: data.user_id ?? user.id,
    full_name: data.full_name,
    phone: data.phone,
    is_verified: data.is_verified ?? false,
    is_frozen: data.is_frozen ?? false,
    is_blocked: data.is_blocked ?? false,
    vehicle_plate: data.vehicle_plate ?? null,
  };
}
