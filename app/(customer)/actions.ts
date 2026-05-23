"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  customerLoginSchema,
  customerSignupSchema,
  normalizeAlgerianPhone,
} from "@/lib/validation/customer-auth";
import { firstZodError } from "@/lib/validation/auth";
import {
  listPublicMerchants,
  type PublicMerchant,
} from "@/lib/data/merchants-public";

export type CustomerAuthState = {
  error?: string;
  success?: string;
};

/**
 * Connexion CLIENT — email + mot de passe.
 * Si le compte appartient à un commerçant (rangée dans `merchants`), on le
 * renvoie vers son espace pro pour éviter la confusion.
 */
export async function customerLogin(
  _prev: CustomerAuthState,
  formData: FormData
): Promise<CustomerAuthState> {
  const parsed = customerLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Email ou mot de passe incorrect" };
    }
    if (error.message.includes("Email not confirmed")) {
      return { error: "Confirme d'abord ton email avant de te connecter." };
    }
    return { error: error.message };
  }

  // Si l'user est en réalité un MARCHAND → redirige vers son espace pro.
  const userId = data.user?.id;
  if (userId) {
    const { data: merchant } = await supabase
      .from("merchants")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (merchant) {
      revalidatePath("/", "layout");
      redirect("/dashboard");
    }
  }

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Inscription CLIENT — crée auth.users + ligne `customers`.
 * Téléphone obligatoire (le commerçant en a besoin pour les commandes).
 */
export async function customerSignup(
  _prev: CustomerAuthState,
  formData: FormData
): Promise<CustomerAuthState> {
  const parsed = customerSignupSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { role: "customer", full_name: parsed.data.full_name },
    },
  });
  if (error) {
    if (error.message.includes("already registered")) {
      return { error: "Un compte existe déjà avec cet email." };
    }
    return { error: error.message };
  }
  if (!data.user) {
    return {
      error: "Inscription créée — vérifie ta boîte email pour confirmer.",
    };
  }

  // Bloque les commerçants qui essaient de s'inscrire en client (trigger DB
  // fait aussi le check, on intercepte avant pour un message clair).
  const { data: existingMerchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (existingMerchant) {
    return {
      error:
        "Ce compte est déjà un commerçant — utilise commercant.coligo.app.",
    };
  }

  const phoneE164 = normalizeAlgerianPhone(parsed.data.phone);
  const { error: insErr } = await supabase.from("customers").insert({
    user_id: data.user.id,
    full_name: parsed.data.full_name,
    phone: phoneE164,
    email: parsed.data.email,
  });
  if (insErr) {
    return { error: `Création du profil client : ${insErr.message}` };
  }

  // Si Supabase a déjà créé une session (confirm email OFF), on redirige.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/");
  }

  return {
    success:
      "Inscription validée — vérifie ta boîte email pour confirmer ton compte.",
  };
}

/**
 * Liste les commerces filtrés par zone (wilaya + commune optionnelle).
 * Appelée par le composant client `MerchantsByZone` après chaque changement
 * de zone côté navigateur.
 */
export async function fetchMerchantsForZone(input: {
  wilaya_code: string | null;
  commune: string | null;
  q?: string | null;
  category?: string | null;
}): Promise<PublicMerchant[]> {
  return listPublicMerchants({
    wilaya_code: input.wilaya_code,
    commune: input.commune,
    q: input.q,
    category: input.category,
    limit: 60,
  });
}

/** Déconnexion client (utilisable depuis n'importe quelle page client). */
export async function customerLogout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Met à jour la localisation préférée du client connecté. Si l'utilisateur
 * n'a pas de compte (anon), no-op silencieux.
 */
export async function updateCustomerLocation(input: {
  wilaya_code: string | null;
  commune: string | null;
  latitude: number | null;
  longitude: number | null;
}): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true };
  const { error } = await supabase
    .from("customers")
    .update({
      default_wilaya_code: input.wilaya_code,
      default_commune: input.commune,
      latitude: input.latitude,
      longitude: input.longitude,
    })
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}
