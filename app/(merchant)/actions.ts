"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  loginSchema,
  signupSchema,
  shopSchema,
  firstZodError,
  type ShopInput,
} from "@/lib/validation/auth";
import { suggestedMinOrderForCategory } from "@/lib/config/payment-limits";
import { getAllCategories } from "@/lib/data/categories";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuthState = {
  error?: string;
  success?: string;
};

/**
 * Pause / fermeture de la réception de commandes (commerçant connecté).
 *
 *  - open             → rouvre (annule toute pause).
 *  - pause_30m/1h/2h  → pause temporaire à réouverture automatique.
 *  - close_today      → fermé jusqu'à la fin de la journée (réouverture demain).
 *  - close_indefinite → fermé jusqu'à réouverture manuelle.
 *
 * Cf. `lib/merchant/pause-state.ts` pour la logique partagée avec le checkout.
 * Une fermeture immédiate ne peut couvrir AU PLUS que la journée ; pour fermer
 * plusieurs jours, le commerçant programme une fermeture (`setScheduledClosure`).
 */
export type ShopPauseMode =
  | "open"
  | "pause_30m"
  | "pause_1h"
  | "pause_2h"
  | "close_today"
  | "close_indefinite";

export async function setShopPause(
  mode: ShopPauseMode
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expirée." };

  const now = new Date();
  let ordersPaused = true;
  let pausedUntil: string | null = null;

  switch (mode) {
    case "open":
      ordersPaused = false;
      pausedUntil = null;
      break;
    case "close_indefinite":
      pausedUntil = null;
      break;
    case "close_today": {
      const end = new Date(now);
      end.setHours(23, 59, 59, 0);
      pausedUntil = end.toISOString();
      break;
    }
    case "pause_30m":
    case "pause_1h":
    case "pause_2h": {
      const mins = mode === "pause_30m" ? 30 : mode === "pause_1h" ? 60 : 120;
      pausedUntil = new Date(now.getTime() + mins * 60_000).toISOString();
      break;
    }
  }

  const { error } = await supabase
    .from("merchants")
    .update({ orders_paused: ordersPaused, paused_until: pausedUntil })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Programme (ou annule) une fermeture sur une plage de dates (congés, travaux).
 * `start`/`end` en ISO ; les deux `null` = annulation. Le commerce est fermé
 * tant que `now()` est dans [start, end] (cf. `computePauseState`).
 */
export async function setScheduledClosure(
  start: string | null,
  end: string | null
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expirée." };

  if (start || end) {
    if (!start || !end) {
      return { ok: false, error: "Indiquez une date de début ET de fin." };
    }
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      return { ok: false, error: "Dates invalides." };
    }
    if (e <= s) {
      return { ok: false, error: "La fin doit être après le début." };
    }
  }

  const { error } = await supabase
    .from("merchants")
    .update({ closure_start: start, closure_end: end })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Connexion email + password.
 */
export async function login(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const { email, password } = parsed.data;

  // Cloisonnement des métiers : les comptes livreur/chauffeur (emails
  // synthétiques internes) ne se connectent jamais sur l'espace commerçant.
  const emailLc = email.toLowerCase();
  if (
    emailLc.endsWith("@drivers.coligo.local") ||
    emailLc.endsWith("@chauffeurs.coligo.local") ||
    emailLc.endsWith("@partners.coligo.local")
  ) {
    return { error: "Email ou mot de passe incorrect" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Email ou mot de passe incorrect" };
    }
    if (error.message.includes("Email not confirmed")) {
      return {
        error: "Veuillez confirmer votre email avant de vous connecter",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Slug URL unique à partir du nom de boutique. Les noms entièrement
 * non-latins (arabe…) donnent une base générique — l'unicité est assurée
 * par un suffixe aléatoire en cas de collision.
 */
function slugifyShopName(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "boutique";
}

/**
 * Valide les champs boutique DÉRIVÉS du formulaire (multi-catégories +
 * position carte) — partagé entre l'inscription email (`signup`) et la
 * complétion après connexion Google (`completeSocialSignup`). Validé AVANT
 * toute écriture : on ne crée jamais un compte auth sur des données refusées.
 */
async function parseShopExtras(
  formData: FormData,
  data: Pick<ShopInput, "latitude" | "longitude" | "category">
): Promise<
  | { error: string }
  | {
      lat: number;
      lng: number;
      catList: string[];
      primaryCategory: string | null;
    }
> {
  // PHASE 2 multi-catégories : liste depuis `categories` (JSON, 1re =
  // principale). À l'inscription, CHAQUE code doit être ACTIF (mig 0311) —
  // masqué / « bientôt disponible » refusé même si le client force la valeur.
  let catList: string[] = [];
  try {
    const raw = formData.get("categories");
    if (typeof raw === "string" && raw) {
      catList = (JSON.parse(raw) as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, 8);
    }
  } catch {
    /* champ absent → repli catégorie simple */
  }
  if (catList.length === 0 && data.category) catList = [data.category];
  catList = [...new Set(catList)];
  if (catList.length > 0) {
    const allCats = await getAllCategories();
    for (const code of catList) {
      const cat = allCats.find((c) => c.code === code);
      if (!cat || cat.status !== "active" || !cat.showSignup) {
        return { error: "Une des catégories choisies n'est pas disponible." };
      }
    }
  }

  // Position carte → nombres bornés (obligatoire, choisie sur la carte).
  const lat = Number(data.latitude);
  const lng = Number(data.longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { error: "Position sur la carte invalide — replacez le repère." };
  }

  return { lat, lng, catList, primaryCategory: catList[0] ?? data.category };
}

/**
 * Crée la ligne `merchants` (+ liaisons multi-catégories) pour `userId` —
 * partagé inscription email / complétion Google. Renvoie un message d'erreur
 * affichable, ou null si la boutique est créée.
 */
async function insertShopForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  data: Pick<
    ShopInput,
    "merchantName" | "managerName" | "address" | "wilayaCode" | "city"
  >,
  extras: {
    lat: number;
    lng: number;
    catList: string[];
    primaryCategory: string | null;
  }
): Promise<string | null> {
  const { merchantName, managerName, address, wilayaCode, city } = data;
  const { lat, lng, catList, primaryCategory } = extras;

  // Slug public unique (URL de la boutique). En cas de collision (même nom de
  // commerce), on suffixe aléatoirement et on réessaie.
  const slugBase = slugifyShopName(merchantName);
  let slug = slugBase;
  let merchantError: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.from("merchants").insert({
      user_id: userId,
      name: merchantName,
      manager_name: managerName,
      slug,
      latitude: lat,
      longitude: lng,
      address,
      category: primaryCategory,
      wilaya_code: wilayaCode,
      city,
      // Validation obligatoire (mig 0273) : créé EN ATTENTE. is_active=false
      // ⇒ invisible des clients (merchants_public) et bloqué au checkout (RLS
      // commande) jusqu'à l'approbation du super-admin.
      is_active: false,
      // Pré-remplit le minimum de commande selon le panier moyen de la catégorie
      // (étude pouvoir d'achat algérien). Le commerçant peut le monter dans ses
      // réglages ; le plancher Coligo s'applique côté checkout.
      min_order_da: suggestedMinOrderForCategory(primaryCategory),
    });
    merchantError = error;
    if (!error) break;
    if (error.code === "23505" && error.message.includes("slug")) {
      slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
      continue;
    }
    break;
  }

  if (merchantError) return merchantError.message;

  // Liaisons multi-catégories (mig 0312) — via service_role (l'inscription
  // sans session confirmée n'a pas de auth.uid pour la RLS owner) ; codes
  // déjà validés ACTIFS par parseShopExtras, FK = catégories existantes. La
  // PRINCIPALE est déjà créée par le trigger (source='primary') : on n'insère
  // QUE les secondaires, en upsert ignoreDuplicates — un insert brut incluant
  // la principale ferait échouer TOUT le lot (PK) et perdrait les secondaires
  // en silence. Best-effort.
  if (catList.length > 1) {
    const { data: createdShop } = await supabase
      .from("merchants")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (createdShop) {
      const adminDb = createAdminClient();
      await adminDb.from("merchant_category_links" as never).upsert(
        catList
          .filter((code) => code !== primaryCategory)
          .map((code) => ({
            merchant_id: createdShop.id,
            code,
            source: "manual",
          })) as never,
        { onConflict: "merchant_id,code", ignoreDuplicates: true }
      );
    }
  }

  return null;
}

/**
 * Inscription d'un nouveau commerçant.
 */
export async function signup(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    merchantName: formData.get("merchantName"),
    managerName: formData.get("managerName"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    address: formData.get("address"),
    category: formData.get("category"),
    wilayaCode: formData.get("wilayaCode"),
    city: formData.get("city"),
  });

  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const { email, password } = parsed.data;

  // Les domaines internes livreur/chauffeur ne sont pas des emails valides ici.
  if (email.toLowerCase().endsWith(".coligo.local")) {
    return { error: "Adresse email invalide." };
  }

  const extras = await parseShopExtras(formData, parsed.data);
  if ("error" in extras) return { error: extras.error };

  const supabase = await createClient();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { merchant_name: parsed.data.merchantName },
    },
  });

  if (signUpError) {
    if (signUpError.message.includes("already registered")) {
      return { error: "Un compte existe déjà avec cet email" };
    }
    if (signUpError.message.toLowerCase().includes("rate limit")) {
      return {
        error:
          "Trop de tentatives d'inscription récentes. Patientez ~1h (limite Supabase d'envoi d'emails) ou configurez un SMTP personnalisé.",
      };
    }
    return { error: signUpError.message };
  }

  if (!signUpData.user) {
    return {
      error:
        "Erreur lors de la création du compte (pas d'utilisateur retourné)",
    };
  }

  let userId = signUpData.user.id;
  let hasSession = !!signUpData.session;

  if (signUpData.user.identities?.length === 0) {
    // Email déjà enregistré. Cas fréquent : une inscription précédente a créé
    // le compte auth mais la création de la boutique avait échoué. On tente de
    // se connecter avec les identifiants fournis pour REPRENDRE l'inscription
    // exactement là où elle s'était arrêtée (aucun compte orphelin).
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !signInData.user) {
      if (signInError?.message.toLowerCase().includes("not confirmed")) {
        return {
          error:
            "Un compte existe déjà avec cet email mais il n'est pas encore confirmé. Cliquez le lien reçu par email, puis connectez-vous.",
        };
      }
      return {
        error:
          "Un compte existe déjà avec cet email. Connectez-vous, ou utilisez « Mot de passe oublié » si vous ne vous souvenez plus du mot de passe.",
      };
    }

    const { data: existingShop } = await supabase
      .from("merchants")
      .select("id")
      .eq("user_id", signInData.user.id)
      .maybeSingle();
    if (existingShop) {
      await supabase.auth.signOut();
      return {
        error: "Un compte existe déjà avec cet email — connectez-vous.",
      };
    }

    userId = signInData.user.id;
    hasSession = true;
  }

  const shopError = await insertShopForUser(
    supabase,
    userId,
    parsed.data,
    extras
  );
  if (shopError) {
    return {
      error: `Compte créé mais erreur création boutique : ${shopError}. Réessayez avec les mêmes email et mot de passe — l'inscription reprendra où elle s'est arrêtée.`,
    };
  }

  if (!hasSession) {
    return {
      success:
        "Compte créé ! Vérifiez votre email pour activer le compte, puis connectez-vous.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Complétion d'inscription commerçant APRÈS une connexion Google (portail
 * /login ou /signup, `intent=merchant`) : l'utilisateur est déjà authentifié,
 * il ne reste qu'à créer la boutique (mêmes règles que `signup` : catégories
 * actives, position carte, créée EN ATTENTE de validation).
 */
export async function completeSocialSignup(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = shopSchema.safeParse({
    merchantName: formData.get("merchantName"),
    managerName: formData.get("managerName"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    address: formData.get("address"),
    category: formData.get("category"),
    wilayaCode: formData.get("wilayaCode"),
    city: formData.get("city"),
  });
  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Session expirée — reconnectez-vous avec Google." };
  }

  // Boutique déjà créée (double soumission, retour arrière) → on n'écrase rien.
  const { data: existingShop } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingShop) redirect("/dashboard");

  const extras = await parseShopExtras(formData, parsed.data);
  if ("error" in extras) return { error: extras.error };

  const shopError = await insertShopForUser(
    supabase,
    user.id,
    parsed.data,
    extras
  );
  if (shopError) {
    return { error: `Erreur création boutique : ${shopError}. Réessayez.` };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Déconnexion.
 */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
