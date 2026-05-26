/**
 * Auth livreur — utilise Supabase auth avec un email synthétique dérivé du
 * téléphone (le livreur ne fournit jamais d'email).
 *
 * Format : <chiffres-du-tel>@drivers.coligo.local
 *   "+213612345678" → "213612345678@drivers.coligo.local"
 *
 * On accepte tout format saisi (espaces, +, etc.) et on normalise.
 */

import { createClient } from "@/lib/supabase/server";

const DOMAIN = "drivers.coligo.local";

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) throw new Error("phone_empty");
  return digits;
}

export function phoneToEmail(rawPhone: string): string {
  return `${normalizePhone(rawPhone)}@${DOMAIN}`;
}

/** Récupère le driver lié au user courant ; null si pas un livreur. */
export async function getCurrentDriver(): Promise<{
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  is_frozen: boolean;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("drivers")
    .select("id, user_id, full_name, phone, is_frozen")
    .eq("user_id", user.id)
    .maybeSingle();
  return data
    ? {
        id: data.id,
        user_id: data.user_id ?? user.id,
        full_name: data.full_name,
        phone: data.phone,
        is_frozen: data.is_frozen ?? false,
      }
    : null;
}
