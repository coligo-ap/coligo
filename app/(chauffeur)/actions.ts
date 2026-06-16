"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizePhone,
  phoneToChauffeurEmail,
  getCurrentChauffeur,
} from "@/lib/auth/chauffeur";
import { isWilaya } from "@/lib/dz/wilayas";
import { signSelfiePath } from "@/lib/drive/avatar-server";
import {
  notifyFemaleDriverOnline,
  notifyRideCustomer,
  notifyRideMessage,
} from "@/lib/fcm/triggers";

export type ChauffeurAuthState = { error?: string; ok?: boolean };

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function rpcClient() {
  const supabase = await createClient();
  // ⚠️ Toujours .bind(supabase) — extraire rpc sans bind casse this.rest.
  return supabase.rpc.bind(supabase) as unknown as Rpc;
}

const DOCS_BUCKET = "driver-docs";

// ---------------------------------------------------------------------------
// AUTH — inscription maquette : nom*, prénom*, tél*, date de naissance*,
// wilaya/ville*, mot de passe*, GAMME du véhicule (Classic/Confort/Moto).
// ---------------------------------------------------------------------------
const signupSchema = z.object({
  last_name: z.string().trim().min(2, "Nom trop court").max(40),
  first_name: z.string().trim().min(2, "Prénom trop court").max(40),
  phone: z.string().min(6, "Téléphone invalide"),
  birth_date: z.string().min(8, "Date de naissance requise"),
  city: z.string().trim().min(2, "Wilaya / ville requise").max(60),
  password: z.string().min(6, "Mot de passe trop court (6 caractères min)"),
  gamme: z.enum(["classic", "confort", "moto"]),
});

export async function chauffeurSignup(
  _prev: ChauffeurAuthState,
  formData: FormData
): Promise<ChauffeurAuthState> {
  const parsed = signupSchema.safeParse({
    last_name: formData.get("last_name"),
    first_name: formData.get("first_name"),
    phone: formData.get("phone"),
    birth_date: formData.get("birth_date"),
    city: formData.get("city"),
    password: formData.get("password"),
    gamme: formData.get("gamme") || "classic",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const supabase = await createClient();
  const phone = normalizePhone(parsed.data.phone);
  const authEmail = phoneToChauffeurEmail(parsed.data.phone);

  const { data: signup, error } = await supabase.auth.signUp({
    email: authEmail,
    password: parsed.data.password,
  });
  if (error || !signup.user) {
    if (error?.message.includes("registered")) {
      return { error: "Ce numéro est déjà enregistré." };
    }
    return { error: error?.message ?? "Échec inscription." };
  }

  const admin = createAdminClient();
  const { error: chErr } = await admin.from("chauffeurs").insert({
    user_id: signup.user.id,
    full_name: `${parsed.data.first_name} ${parsed.data.last_name}`,
    first_name: parsed.data.first_name,
    phone,
    birth_date: parsed.data.birth_date,
    city: parsed.data.city,
    wilaya: isWilaya(parsed.data.city) ? parsed.data.city : null,
    gamme: parsed.data.gamme,
  });
  if (chErr) {
    if (chErr.code === "23505") {
      return { error: "Ce téléphone est déjà utilisé." };
    }
    return { error: `Profil chauffeur : ${chErr.message}` };
  }

  redirect("/chauffeur/documents");
}

const loginSchema = z.object({
  phone: z.string().min(6, "Téléphone invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export async function chauffeurLogin(
  _prev: ChauffeurAuthState,
  formData: FormData
): Promise<ChauffeurAuthState> {
  const parsed = loginSchema.safeParse({
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToChauffeurEmail(parsed.data.phone),
    password: parsed.data.password,
  });
  if (error) return { error: "Téléphone ou mot de passe incorrect." };
  redirect("/chauffeur");
}

export async function chauffeurLogout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/chauffeur/login");
}

// ---------------------------------------------------------------------------
// DOCUMENTS + SELFIE (capture caméra OBLIGATOIRE, import interdit côté UI)
// ---------------------------------------------------------------------------
export type DocKind =
  | "permis_recto"
  | "permis_verso"
  | "carte_grise"
  | "plaque"
  | "assurance"
  | "selfie";

const REQUIRED_DOCS: DocKind[] = [
  "permis_recto",
  "permis_verso",
  "carte_grise",
  "plaque",
  "selfie",
];

export async function uploadChauffeurDoc(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const ch = await getCurrentChauffeur();
  if (!ch) return { ok: false, error: "Session chauffeur introuvable." };
  const kind = String(formData.get("kind") ?? "") as DocKind;
  const file = formData.get("file");
  if (
    ![
      "permis_recto",
      "permis_verso",
      "carte_grise",
      "plaque",
      "assurance",
      "selfie",
    ].includes(kind)
  )
    return { ok: false, error: "Type de document inconnu." };
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Photo manquante." };
  if (file.size > 8 * 1024 * 1024)
    return { ok: false, error: "Photo trop lourde (8 Mo max)." };
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return { ok: false, error: "Format accepté : JPG, PNG ou WEBP." };

  const admin = createAdminClient();
  const path = `chauffeur/${ch.id}/${kind}-${globalThis.crypto.randomUUID()}.jpg`;
  const { error: upErr } = await admin.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: `Upload échoué : ${upErr.message}` };

  // Remplace l'éventuel document existant du même type.
  const { data: existing } = await admin
    .from("chauffeur_documents")
    .select("url")
    .eq("chauffeur_id", ch.id)
    .eq("kind", kind)
    .maybeSingle();
  const { error: dbErr } = await admin
    .from("chauffeur_documents")
    .upsert(
      { chauffeur_id: ch.id, kind, url: path },
      { onConflict: "chauffeur_id,kind" }
    );
  if (dbErr) {
    await admin.storage.from(DOCS_BUCKET).remove([path]);
    return { ok: false, error: dbErr.message };
  }
  if (existing?.url && existing.url !== path) {
    await admin.storage.from(DOCS_BUCKET).remove([existing.url]);
  }
  if (kind === "selfie") {
    await admin.from("chauffeurs").update({ selfie_url: path }).eq("id", ch.id);
  }
  return { ok: true };
}

export type ChauffeurDocInfo = {
  kind: DocKind;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  /** URL signée (1 h) pour APERÇU/visualisation par le chauffeur lui-même. */
  view_url: string | null;
};

/** Documents du chauffeur connecté, avec statut de revue et URL d'aperçu. */
export async function getChauffeurDocs(): Promise<ChauffeurDocInfo[]> {
  const ch = await getCurrentChauffeur();
  if (!ch) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("chauffeur_documents")
    .select("kind, url, status, review_note")
    .eq("chauffeur_id", ch.id);
  const rows = data ?? [];
  // URLs signées en lot (bucket privé) — échec silencieux par pièce.
  const { data: signed } = await admin.storage
    .from(DOCS_BUCKET)
    .createSignedUrls(
      rows.map((r) => r.url),
      3600
    );
  return rows.map((r, i) => ({
    kind: r.kind as DocKind,
    status: (r.status ?? "pending") as ChauffeurDocInfo["status"],
    review_note: r.review_note ?? null,
    view_url: signed?.[i]?.signedUrl ?? null,
  }));
}

/** Supprime une pièce (fichier + ligne). Le dossier devra être renvoyé. */
export async function deleteChauffeurDoc(
  kind: DocKind
): Promise<{ ok: boolean; error?: string }> {
  const ch = await getCurrentChauffeur();
  if (!ch) return { ok: false, error: "Session chauffeur introuvable." };
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("chauffeur_documents")
    .select("id, url")
    .eq("chauffeur_id", ch.id)
    .eq("kind", kind)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document introuvable." };
  const { error } = await admin
    .from("chauffeur_documents")
    .delete()
    .eq("id", doc.id);
  if (error) return { ok: false, error: error.message };
  await admin.storage
    .from(DOCS_BUCKET)
    .remove([doc.url])
    .catch(() => {});
  if (kind === "selfie") {
    await admin.from("chauffeurs").update({ selfie_url: null }).eq("id", ch.id);
  }
  return { ok: true };
}

/** Envoi du dossier : exige permis r/v + carte grise + plaque + selfie. */
export async function submitChauffeurDossier(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const ch = await getCurrentChauffeur();
  if (!ch) return { ok: false, error: "Session chauffeur introuvable." };
  const docs = await getChauffeurDocs();
  const have = new Set(docs.map((d) => d.kind));
  const missing = REQUIRED_DOCS.filter((k) => !have.has(k));
  if (missing.length > 0)
    return {
      ok: false,
      error: missing.includes("selfie")
        ? "Le selfie en direct est obligatoire."
        : "Documents obligatoires manquants.",
    };
  const admin = createAdminClient();
  await admin
    .from("chauffeurs")
    .update({ submitted_at: new Date().toISOString(), rejected_reason: null })
    .eq("id", ch.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GATE — état du compte pour le routage (docs → attente → actif / gelé).
// ---------------------------------------------------------------------------
export type ChauffeurGate = {
  id: string;
  firstName: string;
  fullName: string;
  phone: string;
  gamme: "classic" | "confort" | "moto";
  isVerified: boolean;
  isFrozen: boolean;
  isBlocked: boolean;
  frozenReason: string | null;
  submitted: boolean;
  rejectedReason: string | null;
  homeAddr: string | null;
  homeLat: number | null;
  homeLng: number | null;
  homeDirToleranceDeg: number;
  rating: number | null;
  ridesCount: number;
  memberSince: string;
  isFemaleVerified: boolean;
  vehicle: string | null;
  plate: string | null;
  /** Photo de visage (selfie du dossier), URL signée 1 h. */
  avatarUrl: string | null;
};

export async function getChauffeurGate(): Promise<ChauffeurGate | null> {
  const ch = await getCurrentChauffeur();
  if (!ch) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("chauffeurs")
    .select(
      "id, full_name, first_name, phone, gamme, is_verified, is_frozen, is_blocked, frozen_reason, submitted_at, rejected_reason, home_addr_text, home_lat, home_lng, created_at, is_female_verified, vehicle_make, vehicle_model, vehicle_color, vehicle_plate, selfie_url"
    )
    .eq("id", ch.id)
    .maybeSingle();
  if (!data) return null;
  const [{ data: avg }, { count }] = await Promise.all([
    admin
      .from("rides")
      .select("chauffeur_rating.avg()")
      .eq("chauffeur_id", ch.id)
      .not("chauffeur_rating", "is", null)
      .maybeSingle(),
    admin
      .from("rides")
      .select("id", { count: "exact", head: true })
      .eq("chauffeur_id", ch.id)
      .eq("status", "completed"),
  ]);
  const rating = (avg as { avg?: number } | null)?.avg;
  const { data: st } = await admin
    .from("platform_settings")
    .select("drive_home_dir_tolerance_deg")
    .eq("id", true)
    .maybeSingle();
  const tolerance = st?.drive_home_dir_tolerance_deg ?? 45;
  return {
    id: data.id,
    firstName: data.first_name ?? data.full_name.split(" ")[0],
    fullName: data.full_name,
    phone: data.phone,
    gamme: data.gamme,
    isVerified: data.is_verified,
    isFrozen: data.is_frozen,
    isBlocked: data.is_blocked,
    frozenReason: data.frozen_reason,
    submitted: data.submitted_at != null,
    rejectedReason: data.rejected_reason,
    homeAddr: data.home_addr_text,
    homeLat: data.home_lat,
    homeLng: data.home_lng,
    homeDirToleranceDeg: tolerance,
    rating: rating == null ? null : Math.round(Number(rating) * 10) / 10,
    ridesCount: count ?? 0,
    memberSince: data.created_at,
    isFemaleVerified: data.is_female_verified,
    vehicle:
      [
        [data.vehicle_make, data.vehicle_model].filter(Boolean).join(" "),
        data.vehicle_color,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    plate: data.vehicle_plate,
    avatarUrl: await signSelfiePath(data.selfie_url),
  };
}

// ---------------------------------------------------------------------------
// PRÉSENCE (+ notification « conductrice en ligne » pour le repli rose)
// ---------------------------------------------------------------------------
export async function chauffeurHeartbeat(
  lat: number,
  lng: number,
  online = true
): Promise<void> {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const rpc = await rpcClient();
    await rpc("chauffeur_heartbeat", {
      p_lat: lat,
      p_lng: lng,
      p_online: online,
    });
    if (online) {
      const ch = await getCurrentChauffeur();
      if (ch) {
        const admin = createAdminClient();
        const { data } = await admin
          .from("chauffeurs")
          .select("is_female_verified")
          .eq("id", ch.id)
          .maybeSingle();
        if (data?.is_female_verified) void notifyFemaleDriverOnline();
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Bascule en ligne / hors ligne IMMÉDIATE (bouton GO / Se mettre hors ligne).
 * Met à jour la présence existante sans exiger de coordonnées — le heartbeat
 * périodique (qui porte le flag online côté client) rafraîchit ensuite la
 * position. Hors ligne ⇒ plus de dispatch ni de push « nouvelle course ».
 */
export async function setChauffeurOnline(
  online: boolean
): Promise<{ ok: boolean }> {
  const ch = await getCurrentChauffeur();
  if (!ch) return { ok: false };
  const admin = createAdminClient();
  const { error } = await admin
    .from("chauffeur_presence")
    .update({ is_online: online, updated_at: new Date().toISOString() })
    .eq("chauffeur_id", ch.id);
  return { ok: !error };
}

// ---------------------------------------------------------------------------
// ACCUEIL — gains du jour, plan, zones de demande (heatmap), demandes count.
// ---------------------------------------------------------------------------
export type DriveHome = {
  todayNet: number;
  todayRides: number;
  todayOnlineMin: number;
  plan: "free" | "pro" | "premium";
  planRate: number;
  planPeriodEnd: string | null;
  requestsCount: number;
  heatZones: { lat: number; lng: number; count: number }[];
  homeDirRemaining: number | null;
};

export async function getDriveHome(
  lat: number | null,
  lng: number | null
): Promise<DriveHome | null> {
  const ch = await getCurrentChauffeur();
  if (!ch) return null;
  const rpc = await rpcClient();
  const admin = createAdminClient();

  const [{ data: fin }, rides] = await Promise.all([
    rpc("drive_my_finances", {}),
    lat != null && lng != null
      ? rpc("chauffeur_nearby_rides", {
          p_lat: lat,
          p_lng: lng,
          p_radius_km: 8,
        }).then((r) => (r.data as unknown[]) ?? [])
      : Promise.resolve([] as unknown[]),
  ]);
  const f = (Array.isArray(fin) ? fin[0] : null) as Record<
    string,
    unknown
  > | null;

  // Heatmap : clusters des demandes en recherche (zones de forte demande).
  const { data: searching } = await admin
    .from("rides")
    .select("pickup_lat, pickup_lng")
    .eq("status", "searching")
    .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .limit(200);
  const clusters = new Map<
    string,
    { lat: number; lng: number; count: number }
  >();
  for (const r of searching ?? []) {
    if (r.pickup_lat == null) continue;
    const key = `${r.pickup_lat.toFixed(2)},${r.pickup_lng.toFixed(2)}`;
    const c = clusters.get(key);
    if (c) {
      c.count += 1;
    } else {
      clusters.set(key, { lat: r.pickup_lat, lng: r.pickup_lng, count: 1 });
    }
  }

  return {
    todayNet: Number(f?.today_net_da ?? 0),
    todayRides: Number(f?.today_rides ?? 0),
    todayOnlineMin: Number(f?.today_online_minutes ?? 0),
    plan: ((f?.plan as string) ?? "free") as "free" | "pro" | "premium",
    planRate: Number(f?.plan_rate ?? 0.08),
    planPeriodEnd: (f?.plan_period_end as string) ?? null,
    requestsCount: rides.length,
    heatZones: [...clusters.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    homeDirRemaining: null,
  };
}

// ---------------------------------------------------------------------------
// DEMANDES (liste multi-clients, v2)
// ---------------------------------------------------------------------------
export type NearbyRide = {
  id: string;
  pickup_text: string | null;
  dest_text: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dest_lat: number | null;
  dest_lng: number | null;
  distance_km: number;
  proposed_price_da: number;
  suggested_price_da: number;
  boost_amount_da: number;
  gamme: string;
  female_only: boolean;
  payment_method: string;
  pickup_dist_km: number;
  my_offer_da: number | null;
  customer_name: string;
  customer_rating: number | null;
  customer_since: string | null;
  created_at: string;
};

/**
 * Persiste la ZONE DE TRAVAIL du chauffeur côté serveur (mig 0182) — il ne voit
 * alors que les courses dont le DÉPART est dans sa zone. `null` → retire la zone
 * (repli rayon configurable autour de la position live). Best-effort.
 */
export async function saveChauffeurWorkZone(
  zone: { lat: number; lng: number; radiusKm: number } | null
): Promise<void> {
  try {
    const rpc = await rpcClient();
    await rpc("set_chauffeur_work_zone", {
      p_lat: zone?.lat ?? null,
      p_lng: zone?.lng ?? null,
      p_radius_km: zone?.radiusKm ?? null,
    });
  } catch {
    /* best effort */
  }
}

export async function getNearbyRides(
  lat: number,
  lng: number
): Promise<NearbyRide[]> {
  try {
    const rpc = await rpcClient();
    const { data } = await rpc("chauffeur_nearby_rides", {
      p_lat: lat,
      p_lng: lng,
      p_radius_km: 8,
    });
    return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      id: r.id as string,
      pickup_text: (r.pickup_text as string) ?? null,
      dest_text: (r.dest_text as string) ?? null,
      pickup_lat: (r.pickup_lat as number) ?? null,
      pickup_lng: (r.pickup_lng as number) ?? null,
      dest_lat: (r.dest_lat as number) ?? null,
      dest_lng: (r.dest_lng as number) ?? null,
      distance_km: Number(r.distance_km ?? 0),
      proposed_price_da: (r.proposed_price_da as number) ?? 0,
      suggested_price_da: (r.suggested_price_da as number) ?? 0,
      boost_amount_da: (r.boost_amount_da as number) ?? 0,
      gamme: (r.gamme as string) ?? "classic",
      female_only: Boolean(r.female_only),
      payment_method: (r.payment_method as string) ?? "cash",
      pickup_dist_km: Number(r.pickup_dist_km ?? 0),
      my_offer_da: (r.my_offer_da as number) ?? null,
      customer_name: (r.customer_name as string) ?? "Client",
      customer_rating:
        r.customer_rating == null ? null : Number(r.customer_rating),
      customer_since: (r.customer_since as string) ?? null,
      created_at: r.created_at as string,
    }));
  } catch {
    return [];
  }
}

export async function offerRide(
  rideId: string,
  price: number
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("chauffeur_offer_ride", {
    p_ride_id: rideId,
    p_price: Math.max(0, Math.floor(price)),
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

/** Refus explicite (mig 0149) : la demande disparaît pour ce chauffeur. */
export async function declineRide(
  rideId: string
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("chauffeur_decline_ride", {
    p_ride_id: rideId,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

/** Taux de commission effectif (plan) — pour le net estimé des demandes. */
export async function getChauffeurPlanRate(): Promise<number> {
  const ch = await getCurrentChauffeur();
  if (!ch) return 0.08;
  const rpc = await rpcClient();
  const { data } = await rpc("resolve_drive_plan", { p_chauffeur_id: ch.id });
  const row = (Array.isArray(data) ? data[0] : null) as {
    rate?: number;
  } | null;
  return row?.rate == null ? 0.08 : Number(row.rate);
}

// ---------------------------------------------------------------------------
// COURSE ACTIVE (attribution → prise en charge → course → fin)
// ---------------------------------------------------------------------------
export type ChauffeurActiveRide = {
  id: string;
  status: string;
  pickup_text: string | null;
  dest_text: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dest_lat: number | null;
  dest_lng: number | null;
  distance_km: number;
  agreed_price_da: number;
  boost_amount_da: number;
  payment_method: string;
  prepaid: boolean;
  /** Complément à ENCAISSER EN ESPÈCES (Coligo Pay partiel, mig 0163). */
  cash_due_da: number;
  gamme: string;
  proxy_name: string | null;
  customer_name: string;
  customer_rating: number | null;
  /** Téléphone à appeler : celui du proche (course pour un tiers) sinon client. */
  customer_phone: string | null;
  commission_da: number | null;
  net_da: number | null;
  share_token: string | null;
};

export async function getChauffeurActiveRide(): Promise<ChauffeurActiveRide | null> {
  const ch = await getCurrentChauffeur();
  if (!ch) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("rides")
    .select(
      "id, status, pickup_text, dest_text, pickup_lat, pickup_lng, dest_lat, dest_lng, distance_km, agreed_price_da, proposed_price_da, boost_amount_da, payment_method, cash_due_da, gamme, proxy_name, proxy_phone, customer_id, commission_da, chauffeur_net_da, share_token, customers(full_name, phone)"
    )
    .eq("chauffeur_id", ch.id)
    .in("status", ["accepted", "arriving", "arrived", "in_progress"])
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const cu = data.customers as unknown as {
    full_name: string;
    phone: string | null;
  } | null;
  const { data: avg } = await admin
    .from("rides")
    .select("client_rating.avg()")
    .eq("customer_id", data.customer_id)
    .not("client_rating", "is", null)
    .maybeSingle();
  const rating = (avg as { avg?: number } | null)?.avg;
  return {
    id: data.id,
    status: data.status,
    pickup_text: data.pickup_text,
    dest_text: data.dest_text,
    pickup_lat: data.pickup_lat,
    pickup_lng: data.pickup_lng,
    dest_lat: data.dest_lat,
    dest_lng: data.dest_lng,
    distance_km: Number(data.distance_km ?? 0),
    agreed_price_da: data.agreed_price_da ?? data.proposed_price_da ?? 0,
    boost_amount_da: data.boost_amount_da ?? 0,
    payment_method: data.payment_method,
    prepaid: data.payment_method !== "cash",
    cash_due_da:
      data.payment_method === "coligo_pay" ? (data.cash_due_da ?? 0) : 0,
    gamme: data.gamme,
    proxy_name: data.proxy_name,
    customer_name:
      data.proxy_name ?? (cu ? cu.full_name.split(" ")[0] : "Client"),
    customer_phone: (data.proxy_phone as string | null) ?? cu?.phone ?? null,
    customer_rating:
      rating == null ? null : Math.round(Number(rating) * 10) / 10,
    commission_da: data.commission_da,
    net_da: data.chauffeur_net_da,
    share_token: data.share_token ?? null,
  };
}

export async function setRideStatus(
  rideId: string,
  status: "arriving" | "arrived" | "in_progress",
  pin?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("ride_set_status", {
    p_ride_id: rideId,
    p_status: status,
    p_pin: pin ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  if (row?.ok && status === "arrived") {
    void notifyRideCustomer(rideId, "arrived");
  }
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

export async function completeRideAction(
  rideId: string
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("complete_ride", {
    p_ride_id: rideId,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

export async function cancelRideAction(
  rideId: string,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("cancel_ride", {
    p_ride_id: rideId,
    p_reason: reason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

/** Dernière course terminée (écran gains de fin de course). */
export async function getChauffeurLastDone(sinceMin = 20): Promise<{
  id: string;
  pickup_text: string | null;
  dest_text: string | null;
  price_da: number;
  commission_da: number;
  net_da: number;
  commission_rate: number | null;
  payment_method: string;
  /** Complément encaissé en espèces (Coligo Pay partiel, mig 0163). */
  cash_due_da: number;
  my_rating: number | null;
} | null> {
  const ch = await getCurrentChauffeur();
  if (!ch) return null;
  const admin = createAdminClient();
  const since = new Date(Date.now() - sinceMin * 60_000).toISOString();
  const { data } = await admin
    .from("rides")
    .select(
      "id, pickup_text, dest_text, agreed_price_da, commission_da, chauffeur_net_da, commission_rate_applied, payment_method, cash_due_da, client_rating, completed_at"
    )
    .eq("chauffeur_id", ch.id)
    .eq("status", "completed")
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    pickup_text: data.pickup_text,
    dest_text: data.dest_text,
    price_da: data.agreed_price_da ?? 0,
    commission_da: data.commission_da ?? 0,
    net_da: data.chauffeur_net_da ?? 0,
    commission_rate:
      data.commission_rate_applied == null
        ? null
        : Number(data.commission_rate_applied),
    payment_method: data.payment_method,
    cash_due_da:
      data.payment_method === "coligo_pay" ? (data.cash_due_da ?? 0) : 0,
    my_rating: data.client_rating ?? null,
  };
}

export async function rateClientAction(
  rideId: string,
  rating: number
): Promise<{ ok: boolean }> {
  const rpc = await rpcClient();
  await rpc("rate_ride", { p_ride_id: rideId, p_rating: rating });
  return { ok: true };
}

export async function reportClientAction(
  rideId: string,
  reason: string
): Promise<{ ok: boolean }> {
  const rpc = await rpcClient();
  await rpc("report_ride", { p_ride_id: rideId, p_reason: reason });
  return { ok: true };
}

export async function chauffeurSos(input: {
  rideId: string;
  kind: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ ok: boolean }> {
  const rpc = await rpcClient();
  await rpc("ride_sos", {
    p_ride_id: input.rideId,
    p_kind: input.kind,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
  });
  return { ok: true };
}

// Messages rapides (côté chauffeur).
export async function getChauffeurRideMessages(rideId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ride_messages")
    .select("id, sender, body, created_at, delivered_at, read_at")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: true })
    .limit(80);
  return (data ?? []) as {
    id: string;
    sender: "customer" | "chauffeur";
    body: string;
    created_at: string;
    delivered_at: string | null;
    read_at: string | null;
  }[];
}

/**
 * Marque les messages du CLIENT comme reçus (p_read=false) ou lus (p_read=true).
 * Le client verra alors « Reçu » / « Lu » sur ses messages. RPC SECURITY DEFINER
 * (mig 0175) : ne touche que les horodatages, jamais le corps.
 */
export async function markChauffeurMessagesRead(
  rideId: string,
  read = true
): Promise<void> {
  try {
    const rpc = await rpcClient();
    await rpc("mark_ride_messages_read", { p_ride_id: rideId, p_read: read });
  } catch {
    /* best-effort */
  }
}

export async function sendChauffeurRideMessage(
  rideId: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim().slice(0, 500);
  if (!text) return { ok: false, error: "empty" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ride_messages")
    .insert({ ride_id: rideId, sender: "chauffeur", body: text });
  if (error) return { ok: false, error: error.message };
  // Push au client (fire-and-forget).
  void notifyRideMessage({ rideId, senderRole: "chauffeur", body: text });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// BACK-TO-BACK — course suivante près du point de dépose (file de 1 max).
// ---------------------------------------------------------------------------
export type B2BNext = {
  id: string;
  pickup_text: string | null;
  dest_text: string | null;
  distance_km: number;
  proposed_price_da: number;
  boost_amount_da: number;
  pickup_dist_km: number;
  customer_name: string;
  customer_rating: number | null;
};

export async function getB2BNext(rideId: string): Promise<B2BNext | null> {
  const rpc = await rpcClient();
  const { data } = await rpc("drive_b2b_next", { p_ride_id: rideId });
  const r = (Array.isArray(data) ? data[0] : null) as Record<
    string,
    unknown
  > | null;
  if (!r) return null;
  return {
    id: r.id as string,
    pickup_text: (r.pickup_text as string) ?? null,
    dest_text: (r.dest_text as string) ?? null,
    distance_km: Number(r.distance_km ?? 0),
    proposed_price_da: (r.proposed_price_da as number) ?? 0,
    boost_amount_da: (r.boost_amount_da as number) ?? 0,
    pickup_dist_km: Number(r.pickup_dist_km ?? 0),
    customer_name: (r.customer_name as string) ?? "Client",
    customer_rating:
      r.customer_rating == null ? null : Number(r.customer_rating),
  };
}

// ---------------------------------------------------------------------------
// GAINS / FINANCES / ABONNEMENTS
// ---------------------------------------------------------------------------
export type ChauffeurFinances = {
  todayNet: number;
  todayRides: number;
  todayOnlineMin: number;
  monthGross: number;
  monthRides: number;
  monthCommission: number;
  monthNet: number;
  monthSubFee: number;
  dueUnsettled: number;
  plan: "free" | "pro" | "premium";
  planRate: number;
  planPeriodEnd: string | null;
  rating: number | null;
  ridesTotal: number;
  proFee: number;
  proRate: number;
  premiumFee: number;
  /** Facteurs de tarif par durée (× tarif mensuel) : 1 sem / 2 sem. */
  weekFactor: number;
  twoWeekFactor: number;
  ccp: { number: string; key: string; name: string };
  pendingSub: { plan: string; amount: number; method: string } | null;
  /** Début de la période d'abonnement active (affichage « du X au Y »). */
  planPeriodStart: string | null;
  /** Devis d'upgrade Pro → Premium (prorata des jours restants). */
  upgradeQuote: { amountDa: number; daysLeft: number } | null;
};

export async function getChauffeurFinances(): Promise<ChauffeurFinances | null> {
  const ch = await getCurrentChauffeur();
  if (!ch) return null;
  const rpc = await rpcClient();
  const admin = createAdminClient();
  const [{ data: fin }, { data: s }, { data: pending }, { data: activeSub }] =
    await Promise.all([
      rpc("drive_my_finances", {}),
      admin
        .from("platform_settings")
        .select(
          "drive_plan_pro_fee_da, drive_plan_pro_rate, drive_plan_premium_fee_da, drive_sub_week_factor, drive_sub_2week_factor, drive_ccp_number, drive_ccp_key, drive_ccp_name"
        )
        .eq("id", true)
        .maybeSingle(),
      admin
        .from("chauffeur_subscription_payments")
        .select("plan, amount_da, method")
        .eq("chauffeur_id", ch.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("chauffeur_subscriptions")
        .select("plan, period_start, period_end")
        .eq("chauffeur_id", ch.id)
        .eq("status", "active")
        .gt("period_end", new Date().toISOString())
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  const f = (Array.isArray(fin) ? fin[0] : null) as Record<
    string,
    unknown
  > | null;
  if (!f) return null;
  return {
    todayNet: Number(f.today_net_da ?? 0),
    todayRides: Number(f.today_rides ?? 0),
    todayOnlineMin: Number(f.today_online_minutes ?? 0),
    monthGross: Number(f.month_gross_da ?? 0),
    monthRides: Number(f.month_rides ?? 0),
    monthCommission: Number(f.month_commission_da ?? 0),
    monthNet: Number(f.month_net_da ?? 0),
    monthSubFee: Number(f.month_sub_fee_da ?? 0),
    dueUnsettled: Number(f.due_unsettled_da ?? 0),
    plan: ((f.plan as string) ?? "free") as "free" | "pro" | "premium",
    planRate: Number(f.plan_rate ?? 0.08),
    planPeriodEnd: (f.plan_period_end as string) ?? null,
    rating: f.rating == null ? null : Number(f.rating),
    ridesTotal: Number(f.rides_total ?? 0),
    proFee: s?.drive_plan_pro_fee_da ?? 2000,
    proRate: Number(s?.drive_plan_pro_rate ?? 0.035),
    premiumFee: s?.drive_plan_premium_fee_da ?? 3900,
    weekFactor: Number(s?.drive_sub_week_factor ?? 0.35),
    twoWeekFactor: Number(s?.drive_sub_2week_factor ?? 0.6),
    ccp: {
      number: s?.drive_ccp_number ?? "—",
      key: s?.drive_ccp_key ?? "—",
      name: s?.drive_ccp_name ?? "Coligo",
    },
    pendingSub: pending
      ? {
          plan: pending.plan,
          amount: pending.amount_da,
          method: pending.method,
        }
      : null,
    planPeriodStart: activeSub?.period_start ?? null,
    // Devis upgrade Pro → Premium : différence de tarif au prorata des jours
    // restants, même échéance (le RPC drive_sub_upgrade recalcule au clic —
    // ceci n'est qu'un AFFICHAGE).
    upgradeQuote: (() => {
      const plan = ((f.plan as string) ?? "free") as string;
      if (plan !== "pro" || !activeSub?.period_end) return null;
      const daysLeft = Math.min(
        30,
        Math.max(
          1,
          Math.ceil(
            (new Date(activeSub.period_end).getTime() - Date.now()) / 86400000
          )
        )
      );
      const proFee = s?.drive_plan_pro_fee_da ?? 1500;
      const premiumFee = s?.drive_plan_premium_fee_da ?? 3900;
      return {
        amountDa: Math.max(
          100,
          Math.round(((premiumFee - proFee) * daysLeft) / 30)
        ),
        daysLeft,
      };
    })(),
  };
}

/** Annule la tentative de paiement d'abonnement en attente (carte abandonnée…). */
export async function cancelMyPendingSub(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("drive_sub_cancel_my_pending", {});
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  if (!row?.ok) return { ok: false, error: row?.reason ?? "Échec." };
  return { ok: true };
}

/**
 * Souscription : CCP → « j'ai payé » (vérification admin 24 h) ;
 * carte → checkout Chargily (activation immédiate via webhook).
 */
export async function subscribeDrivePlan(
  plan: "pro" | "premium",
  method: "ccp" | "card",
  opts?: { upgrade?: boolean; durationDays?: 7 | 14 | 30 }
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const rpc = await rpcClient();
  // Upgrade Pro → Premium : montant au prorata des jours restants (calculé
  // côté SQL, source de vérité), même date de renouvellement (la durée ne
  // s'applique pas à un upgrade). Sinon : souscription à la durée choisie.
  const { data, error } = opts?.upgrade
    ? await rpc("drive_sub_upgrade", { p_method: method })
    : await rpc("drive_subscribe", {
        p_plan: plan,
        p_method: method,
        p_duration_days: opts?.durationDays ?? 30,
      });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
    payment_id?: string;
    amount_da?: number;
  };
  if (!row?.ok) return { ok: false, error: row?.reason };
  if (method === "ccp") return { ok: true };

  // Carte bancaire : Chargily, activation immédiate après webhook.
  try {
    const { createCheckout } = await import("@/lib/payments/chargily");
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    if (!base) return { ok: false, error: "Paiement carte indisponible." };
    const checkout = await createCheckout({
      amount: row.amount_da ?? 0,
      successUrl: `${base}/chauffeur/abonnement?card=success`,
      failureUrl: `${base}/chauffeur/abonnement?card=failed`,
      webhookEndpoint: `${base}/api/chargily/webhook`,
      metadata: { type: "drive_sub", payment_id: row.payment_id ?? null },
      description: `Abonnement Coligo Drive ${plan}`,
      locale: "fr",
    });
    return { ok: true, url: checkout.checkout_url };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Paiement carte indisponible.",
    };
  }
}

// ---------------------------------------------------------------------------
// « JE RENTRE CHEZ MOI » + HISTORIQUE
// ---------------------------------------------------------------------------
export async function setChauffeurHome(
  addr: string,
  coords?: { lat: number; lng: number }
): Promise<{ ok: boolean; error?: string; nextAllowed?: string }> {
  // Coordonnées exactes fournies par le sélecteur carte (cas nominal) ;
  // sinon géocodage du texte (G4 : le filtre directionnel a besoin de lat/lng).
  let lat: number | null = coords?.lat ?? null;
  let lng: number | null = coords?.lng ?? null;
  if (lat == null || lng == null) {
    try {
      const { geocodeSearch } = await import("@/app/(customer)/actions");
      const res = await geocodeSearch({ q: addr });
      if (res.ok && res.results[0]) {
        lat = res.results[0].lat;
        lng = res.results[0].lng;
      }
    } catch {
      /* adresse non géocodable : le toggle restera sans filtre géo */
    }
  }
  const rpc = await rpcClient();
  const { data, error } = await rpc("chauffeur_set_home", {
    p_addr: addr,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
    next_allowed?: string;
  };
  if (row?.ok) return { ok: true };
  if (row?.reason === "rate_limited") {
    const when = row.next_allowed
      ? new Date(row.next_allowed).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
        })
      : "";
    return {
      ok: false,
      nextAllowed: row.next_allowed,
      error: `Adresse modifiable 1 fois par semaine (anti-fraude)${when ? ` — prochain changement possible le ${when}` : ""}.`,
    };
  }
  return { ok: false, error: row?.reason ?? "Échec." };
}

export async function activateHomeDir(): Promise<{
  ok: boolean;
  remaining?: number;
  error?: string;
}> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("chauffeur_home_dir_activate", {});
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
    remaining?: number;
  };
  if (row?.ok) return { ok: true, remaining: row.remaining };
  return {
    ok: false,
    error:
      row?.reason === "daily_limit"
        ? "Limite atteinte : 2 activations par jour."
        : row?.reason === "no_home_addr"
          ? "Renseignez d'abord votre adresse domicile."
          : row?.reason,
  };
}

export type ChauffeurHistoryRide = {
  id: string;
  customer_name: string;
  dest_text: string | null;
  when: string;
  price_da: number;
  net_da: number | null;
  gamme: string;
  boosted: boolean;
  completed: boolean;
  cancelled_by: string | null;
};

export async function getChauffeurHistory(): Promise<ChauffeurHistoryRide[]> {
  const ch = await getCurrentChauffeur();
  if (!ch) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("rides")
    .select(
      "id, dest_text, created_at, status, agreed_price_da, proposed_price_da, chauffeur_net_da, gamme, boost_amount_da, cancelled_by, customers(full_name)"
    )
    .eq("chauffeur_id", ch.id)
    .in("status", ["completed", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(40);
  return (data ?? []).map((r) => {
    const cu = r.customers as unknown as { full_name: string } | null;
    return {
      id: r.id,
      customer_name: cu ? cu.full_name.split(" ")[0] : "Client",
      dest_text: r.dest_text,
      when: r.created_at,
      price_da: r.agreed_price_da ?? r.proposed_price_da ?? 0,
      net_da: r.chauffeur_net_da,
      gamme: r.gamme,
      boosted: (r.boost_amount_da ?? 0) > 0,
      completed: r.status === "completed",
      cancelled_by: r.cancelled_by,
    };
  });
}

// ---------------------------------------------------------------------------
// CONTACTS D'URGENCE (chauffeur) — même mécanique que côté client.
// ---------------------------------------------------------------------------
export type SosContact = { name: string; phone: string };

export async function getChauffeurSosContacts(): Promise<SosContact[]> {
  const ch = await getCurrentChauffeur();
  if (!ch) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("chauffeurs")
    .select("sos_contacts")
    .eq("id", ch.id)
    .maybeSingle();
  const raw = (data?.sos_contacts ?? []) as SosContact[];
  return Array.isArray(raw)
    ? raw.filter((c) => c && c.name && c.phone).slice(0, 3)
    : [];
}

export async function setChauffeurSosContacts(
  contacts: SosContact[]
): Promise<{ ok: boolean; error?: string }> {
  const ch = await getCurrentChauffeur();
  if (!ch) return { ok: false, error: "auth" };
  const clean = (contacts ?? [])
    .map((c) => ({
      name: String(c.name ?? "")
        .trim()
        .slice(0, 40),
      phone: String(c.phone ?? "")
        .trim()
        .slice(0, 20),
    }))
    .filter((c) => c.name && c.phone.length >= 9)
    .slice(0, 3);
  const admin = createAdminClient();
  const { error } = await admin
    .from("chauffeurs")
    .update({ sos_contacts: clean })
    .eq("id", ch.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** CCP du chauffeur (facultatif — requis avant le premier versement). */
export async function setChauffeurCcp(
  ccpNumber: string,
  ccpKey: string
): Promise<{ ok: boolean; error?: string }> {
  const ch = await getCurrentChauffeur();
  if (!ch) return { ok: false, error: "auth" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("chauffeurs")
    .update({
      ccp_number: ccpNumber.trim().slice(0, 30) || null,
      ccp_key: ccpKey.trim().slice(0, 5) || null,
    })
    .eq("id", ch.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
