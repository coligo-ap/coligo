"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// /admin/zones — moteur de zones (mig 0169). Toutes les écritures sont gardées
// par isSuperAdmin() + tracées dans admin_audit_log. Service_role → bypass RLS.
// =============================================================================

export type ZoneActionState = { error?: string; ok?: boolean };

// Les tables `service_zone_*` ne sont pas (encore) dans database.types.ts généré
// (gen types nécessite Docker). On caste l'accès comme ailleurs dans le code.
type DbErr = { message: string; code?: string } | null;
type Resp = Promise<{ data: unknown; error: DbErr }>;
type ZoneBuilder = {
  insert: (v: Record<string, unknown>) => {
    select: (c: string) => {
      single: () => Promise<{ data: { id?: string } | null; error: DbErr }>;
    };
  };
  update: (v: Record<string, unknown>) => {
    eq: (c: string, val: unknown) => Resp;
  };
  delete: () => { eq: (c: string, val: unknown) => Resp };
  upsert: (v: Record<string, unknown>, opts?: Record<string, unknown>) => Resp;
};
function zoneTable(
  admin: ReturnType<typeof createAdminClient>,
  name: "service_zone_rules" | "service_zone_defaults"
): ZoneBuilder {
  return (admin.from as unknown as (n: string) => ZoneBuilder)(name);
}

async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

async function audit(action: string, ruleId: string | null, note?: string) {
  try {
    const admin = createAdminClient();
    await admin.from("admin_audit_log").insert({
      admin_email: await adminEmail(),
      action,
      target_kind: "zone",
      target_id: ruleId,
      note: note ?? null,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action */
  }
}

const SERVICE = z.enum(["express", "tour", "drive"]);

const ruleSchema = z
  .object({
    label: z.string().trim().min(2, "Nom trop court").max(80),
    service: SERVICE,
    mode: z.enum(["allow", "block"]),
    scope: z.enum(["country", "wilaya", "commune", "radius", "polygon"]),
    direction: z.enum(["any", "origin", "destination"]).default("any"),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
    coming_soon: z.boolean().default(false),
    note: z.string().trim().max(300).optional().nullable(),
    country_code: z.string().trim().max(4).optional().nullable(),
    wilaya_code: z.string().trim().max(4).optional().nullable(),
    commune: z.string().trim().max(80).optional().nullable(),
    center_lat: z.number().min(-90).max(90).optional().nullable(),
    center_lng: z.number().min(-180).max(180).optional().nullable(),
    radius_km: z.number().positive().max(2000).optional().nullable(),
    polygon: z
      .array(z.tuple([z.number(), z.number()]))
      .min(3)
      .optional()
      .nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "wilaya" && !v.wilaya_code)
      ctx.addIssue({
        code: "custom",
        message: "Wilaya requise.",
        path: ["wilaya_code"],
      });
    if (v.scope === "commune" && (!v.wilaya_code || !v.commune))
      ctx.addIssue({
        code: "custom",
        message: "Wilaya + commune requises.",
        path: ["commune"],
      });
    if (
      v.scope === "radius" &&
      (v.center_lat == null || v.center_lng == null || !v.radius_km)
    )
      ctx.addIssue({
        code: "custom",
        message: "Centre + rayon requis.",
        path: ["radius_km"],
      });
    if (v.scope === "polygon" && (!v.polygon || v.polygon.length < 3))
      ctx.addIssue({
        code: "custom",
        message: "Dessinez un polygone (≥ 3 points).",
        path: ["polygon"],
      });
  });

export type ZoneRuleInput = z.input<typeof ruleSchema>;

export async function createZoneRule(
  input: ZoneRuleInput
): Promise<ZoneActionState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  const v = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await zoneTable(admin, "service_zone_rules")
    .insert({
      label: v.label,
      service: v.service,
      mode: v.mode,
      scope: v.scope,
      direction: v.direction,
      priority: v.priority,
      coming_soon: v.coming_soon,
      note: v.note ?? null,
      country_code: v.scope === "country" ? (v.country_code ?? "DZ") : null,
      wilaya_code:
        v.scope === "wilaya" || v.scope === "commune" ? v.wilaya_code : null,
      commune: v.scope === "commune" ? v.commune : null,
      center_lat: v.scope === "radius" ? v.center_lat : null,
      center_lng: v.scope === "radius" ? v.center_lng : null,
      radius_km: v.scope === "radius" ? v.radius_km : null,
      polygon: v.scope === "polygon" ? v.polygon : null,
      created_by: await adminEmail(),
    })
    .select("id")
    .single();
  if (error) return { error: `Échec : ${error.message}` };
  await audit(
    "zone_rule_create",
    data?.id ?? null,
    `${v.service}/${v.mode}/${v.scope} · ${v.label}`
  );
  revalidatePath("/admin/zones");
  return { ok: true };
}

export async function toggleZoneRule(
  id: string,
  active: boolean
): Promise<ZoneActionState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await zoneTable(admin, "service_zone_rules")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  await audit(active ? "zone_rule_enable" : "zone_rule_disable", id);
  revalidatePath("/admin/zones");
  return { ok: true };
}

export async function updateZoneRulePriority(
  id: string,
  priority: number
): Promise<ZoneActionState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const p = Math.max(0, Math.min(1000, Math.trunc(priority)));
  const admin = createAdminClient();
  const { error } = await zoneTable(admin, "service_zone_rules")
    .update({ priority: p, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  await audit("zone_rule_priority", id, `priority=${p}`);
  revalidatePath("/admin/zones");
  return { ok: true };
}

export async function deleteZoneRule(id: string): Promise<ZoneActionState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await zoneTable(admin, "service_zone_rules")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  await audit("zone_rule_delete", id);
  revalidatePath("/admin/zones");
  return { ok: true };
}

const defaultsSchema = z.object({
  service: SERVICE,
  default_allow: z.boolean(),
  service_active: z.boolean(),
  max_distance_km: z.number().positive().max(2000).nullable().optional(),
});

export async function saveServiceDefaults(
  input: z.input<typeof defaultsSchema>
): Promise<ZoneActionState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const parsed = defaultsSchema.safeParse(input);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  const v = parsed.data;
  const admin = createAdminClient();
  const { error } = await zoneTable(admin, "service_zone_defaults").upsert(
    {
      service: v.service,
      default_allow: v.default_allow,
      service_active: v.service_active,
      max_distance_km: v.max_distance_km ?? null,
      updated_by: await adminEmail(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "service" }
  );
  if (error) return { error: error.message };
  await audit(
    "zone_defaults_save",
    null,
    `${v.service} · allow=${v.default_allow} active=${v.service_active}`
  );
  revalidatePath("/admin/zones");
  return { ok: true };
}
