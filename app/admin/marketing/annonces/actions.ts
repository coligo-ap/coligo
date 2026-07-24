"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { getAuthUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAnnouncements } from "@/lib/realtime/broadcast";
import {
  dispatchAnnouncement,
  type DispatchableAnnouncement,
} from "@/lib/announcements/dispatch";

// =============================================================================
// Actions Marketing → Annonces (mig 0408). Garde adminCan('marketing') puis
// écritures service_role + journal APPEND-ONLY `admin_audit_log` à chaque
// création/publication/désactivation.
// =============================================================================

export type AnnouncementButtonInput = {
  label_fr: string;
  label_ar: string;
  action: "acknowledge" | "redirect_internal" | "redirect_external" | "dismiss";
  target?: string | null;
};

export type AnnouncementInput = {
  id?: string | null;
  title_fr: string;
  title_ar: string;
  body_fr: string;
  body_ar: string;
  image_url?: string | null;
  audiences: string[];
  channel: "push" | "popup" | "both";
  popup_mode: "next_open" | "instant" | "route";
  route_prefix?: string | null;
  blocking: boolean;
  buttons: AnnouncementButtonInput[];
  starts_at?: string | null; // ISO — null = maintenant
  ends_at?: string | null;
};

type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const AUDIENCES = ["customer", "merchant", "driver", "chauffeur"];

function validate(input: AnnouncementInput): string | null {
  if (!input.title_fr.trim() || !input.title_ar.trim())
    return "Titre FR et AR requis.";
  if (!input.body_fr.trim() || !input.body_ar.trim())
    return "Message FR et AR requis.";
  if (
    input.audiences.length === 0 ||
    input.audiences.some((a) => !AUDIENCES.includes(a))
  )
    return "Choisis au moins une audience valide.";
  if (input.buttons.length > 2) return "2 boutons maximum.";
  if (input.blocking && input.buttons.length === 0)
    return "Une annonce bloquante doit avoir au moins un bouton.";
  if (input.popup_mode === "route" && !input.route_prefix?.trim())
    return "Le mode « page précise » exige un préfixe de route.";
  for (const b of input.buttons) {
    if (!b.label_fr.trim() || !b.label_ar.trim())
      return "Chaque bouton doit avoir un libellé FR et AR.";
    if (b.action === "redirect_internal" && !b.target?.startsWith("/"))
      return "Cible interne : un chemin commençant par « / ».";
    if (b.action === "redirect_external" && !b.target?.startsWith("https://"))
      return "Cible externe : une URL https://…";
  }
  if (input.image_url && !/^https?:\/\//.test(input.image_url))
    return "Image : URL http(s) valide.";
  return null;
}

function db() {
  const admin = createAdminClient();
  return {
    admin,
    from: admin.from.bind(admin) as unknown as (t: string) => {
      insert: (v: Record<string, unknown>) => {
        select: (c: string) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v2: string
        ) => {
          select: (c2: string) => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
      delete: () => {
        eq: (
          c: string,
          v2: string
        ) => {
          eq: (
            c2: string,
            v3: string
          ) => Promise<{ error: { message: string } | null }>;
        };
      };
      select: (c: string) => {
        eq: (
          c2: string,
          v2: string
        ) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
          }>;
        };
      };
    },
  };
}

async function audit(action: string, targetId: string, note?: string) {
  try {
    const { admin } = db();
    const user = await getAuthUser();
    await admin.from("admin_audit_log").insert({
      admin_email: user?.email ?? null,
      action,
      target_kind: "announcement",
      target_id: targetId,
      note: note ?? null,
    });
  } catch (e) {
    console.warn("[annonces] audit:", e);
  }
}

function rowToPayload(input: AnnouncementInput) {
  return {
    title_fr: input.title_fr.trim(),
    title_ar: input.title_ar.trim(),
    body_fr: input.body_fr.trim(),
    body_ar: input.body_ar.trim(),
    image_url: input.image_url?.trim() || null,
    audiences: input.audiences,
    channel: input.channel,
    popup_mode: input.popup_mode,
    route_prefix:
      input.popup_mode === "route"
        ? (input.route_prefix?.trim() ?? null)
        : null,
    blocking: input.blocking,
    buttons: input.buttons.map((b) => ({
      label_fr: b.label_fr.trim(),
      label_ar: b.label_ar.trim(),
      action: b.action,
      target: b.target?.trim() || null,
    })),
    starts_at: input.starts_at ?? new Date().toISOString(),
    ends_at: input.ends_at ?? null,
    updated_at: new Date().toISOString(),
  };
}

/** Crée/édite un BROUILLON (une annonce publiée reste éditable hors dispatch). */
export async function saveAnnouncement(
  input: AnnouncementInput
): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const { from } = db();
  const payload = rowToPayload(input);

  if (input.id) {
    const { data, error } = await from("announcements")
      .update(payload)
      .eq("id", input.id)
      .select("id")
      .maybeSingle();
    if (error || !data)
      return { ok: false, error: "Enregistrement impossible." };
    await audit("announcement_save", input.id);
    revalidatePath("/admin/marketing/annonces");
    return { ok: true, id: input.id };
  }

  const user = await getAuthUser();
  const { data, error } = await from("announcements")
    .insert({ ...payload, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Création impossible." };
  await audit("announcement_save", data.id as string);
  revalidatePath("/admin/marketing/annonces");
  return { ok: true, id: data.id as string };
}

/**
 * Publie : l'annonce devient visible dans sa fenêtre. Si elle est déjà due,
 * la diffusion (push + éventuel bump instantané) part IMMÉDIATEMENT ; sinon
 * la push partira au cron quotidien (ou via « Envoyer la push maintenant »).
 */
export async function publishAnnouncement(id: string): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };

  const { from } = db();
  const { data, error } = await from("announcements")
    .update({ status: "published", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(
      "id, title_fr, body_fr, audiences, channel, popup_mode, starts_at, ends_at, push_sent_at, disabled_at"
    )
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Publication impossible." };

  const due =
    new Date(data.starts_at as string) <= new Date() &&
    !data.disabled_at &&
    (!data.ends_at || new Date(data.ends_at as string) > new Date());
  if (due && !data.push_sent_at) {
    const { pushSent } = await dispatchAnnouncement(
      data as unknown as DispatchableAnnouncement
    );
    await audit("announcement_publish", id, `push=${pushSent}`);
  } else if (due) {
    // Push déjà partie (re-publication) : on ne renvoie que le bump éventuel.
    if (data.popup_mode === "instant") {
      void broadcastAnnouncements(data.audiences as string[]);
    }
    await audit("announcement_publish", id, "republication");
  } else {
    await audit("announcement_publish", id, "programmée");
  }

  revalidatePath("/admin/marketing/annonces");
  return { ok: true };
}

/** Force l'envoi de la push d'une annonce programmée déjà due (sans cron). */
export async function sendAnnouncementPushNow(
  id: string
): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const { from } = db();
  const { data } = await from("announcements")
    .select(
      "id, title_fr, body_fr, audiences, channel, popup_mode, status, push_sent_at, disabled_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!data || data.status !== "published" || data.disabled_at) {
    return { ok: false, error: "Annonce non publiée." };
  }
  if (data.push_sent_at) return { ok: false, error: "Push déjà envoyée." };
  if (data.channel === "popup") {
    return { ok: false, error: "Cette annonce est pop-up seule." };
  }
  const { pushSent } = await dispatchAnnouncement(
    data as unknown as DispatchableAnnouncement
  );
  await audit("announcement_push_now", id, `push=${pushSent}`);
  revalidatePath("/admin/marketing/annonces");
  return { ok: true };
}

/** Coupe une annonce EN COURS : disparaît aussi des apps ouvertes (bump). */
export async function disableAnnouncement(id: string): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const { from } = db();
  const { data, error } = await from("announcements")
    .update({
      disabled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, audiences")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Désactivation impossible." };
  void broadcastAnnouncements(data.audiences as string[]);
  await audit("announcement_disable", id);
  revalidatePath("/admin/marketing/annonces");
  return { ok: true };
}

/** Supprime un BROUILLON uniquement (le reste = désactiver, jamais effacer). */
export async function deleteAnnouncement(id: string): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const { from } = db();
  const { error } = await from("announcements")
    .delete()
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: "Suppression impossible." };
  await audit("announcement_delete_draft", id);
  revalidatePath("/admin/marketing/annonces");
  return { ok: true };
}
