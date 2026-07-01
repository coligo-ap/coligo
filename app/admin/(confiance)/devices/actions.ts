"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminCan } from "@/lib/auth/admin";

export type DeviceActionResult = {
  ok?: boolean;
  error?: string;
  count?: number;
};

// Les RPC (mig 0287) ne sont pas dans database.types généré → cast du NOM et des
// args `as never`, mais on garde l'appel supabase.rpc(...) pour le binding `this`.

/** Bloque une IP (avec message optionnel affiché à l'utilisateur bloqué). */
export async function blockIp(
  ip: string,
  message: string
): Promise<DeviceActionResult> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "admin_block_ip" as never,
    {
      p_ip: ip,
      p_message: message.trim() || null,
    } as never
  );
  if (error) return { error: error.message };
  revalidatePath("/admin/devices");
  return { ok: true };
}

/** Débloque une IP. */
export async function unblockIp(ip: string): Promise<DeviceActionResult> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "admin_unblock_ip" as never,
    {
      p_ip: ip,
    } as never
  );
  if (error) return { error: error.message };
  revalidatePath("/admin/devices");
  return { ok: true };
}

/** Déconnecte (supprime les sessions GoTrue) de tous les comptes vus sur l'IP. */
export async function disconnectIp(ip: string): Promise<DeviceActionResult> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_disconnect_ip" as never,
    {
      p_ip: ip,
    } as never
  );
  if (error) return { error: error.message };
  revalidatePath("/admin/devices");
  return { ok: true, count: Number(data ?? 0) };
}

/** Déconnecte un compte précis (toutes ses sessions). */
export async function disconnectUser(
  userId: string
): Promise<DeviceActionResult> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_disconnect_user" as never,
    {
      p_user_id: userId,
    } as never
  );
  if (error) return { error: error.message };
  revalidatePath("/admin/devices");
  return { ok: true, count: Number(data ?? 0) };
}
