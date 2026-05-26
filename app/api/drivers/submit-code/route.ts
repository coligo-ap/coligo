import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashReferralCode } from "@/lib/drivers/referral-code";
import { notifyMerchantNewDriverRequest } from "@/lib/fcm/triggers";

/**
 * POST /api/drivers/submit-code — un livreur soumet un code de référence.
 *
 * Logique back uniquement (l'UI complète arrive au prompt 4 — PWA livreur).
 * Cet endpoint est conçu pour être appelable :
 *  - depuis un livreur AUTHENTIFIÉ (auth.uid()) → on lie via drivers.user_id.
 *  - depuis un onboarding livreur SANS user encore (étape 3 / prompt 4 :
 *    on créera un compte auth juste avant). À ce stade, l'endpoint exige
 *    la session (sinon refus 401).
 *
 * Le code en clair NE part jamais en log — on log seulement le hash et
 * le résultat (accepted/rejected).
 *
 * Payload : { code: "BOUL-K4Q7X9", full_name?, phone? }
 *  - full_name / phone : utilisés seulement si la ligne `drivers` n'existe
 *    pas encore pour ce user (création paresseuse du profil minimum).
 */

type Body = { code?: unknown; full_name?: unknown; phone?: unknown };

export async function POST(req: Request) {
  const ssr = await createClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 64) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const codeHash = hashReferralCode(code);
  const admin = createAdminClient();

  // 1) Cherche un code ACTIF correspondant.
  const { data: refRow } = await admin
    .from("merchant_referral_codes")
    .select("merchant_id, expires_at, is_active")
    .eq("code_hash", codeHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!refRow) {
    return NextResponse.json({ error: "code_unknown" }, { status: 404 });
  }
  if (refRow.expires_at && new Date(refRow.expires_at) < new Date()) {
    return NextResponse.json({ error: "code_expired" }, { status: 410 });
  }

  // 2) Profil livreur (création paresseuse si premier code soumis).
  const { data: existingDriver } = await admin
    .from("drivers")
    .select("id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  let driverId = existingDriver?.id ?? null;
  let driverFullName = existingDriver?.full_name ?? "Livreur";
  if (!driverId) {
    const fullName =
      typeof body.full_name === "string" && body.full_name.trim().length > 0
        ? body.full_name.trim()
        : (user.email?.split("@")[0] ?? "Livreur");
    const phone =
      typeof body.phone === "string" && body.phone.trim().length > 0
        ? body.phone.trim()
        : (user.phone ?? `pending-${user.id.slice(0, 8)}`);
    const { data: created, error: createErr } = await admin
      .from("drivers")
      .insert({
        user_id: user.id,
        full_name: fullName,
        phone,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: `driver_create_failed:${createErr?.message ?? ""}` },
        { status: 500 }
      );
    }
    driverId = created.id;
    driverFullName =
      typeof body.full_name === "string" && body.full_name.trim().length > 0
        ? body.full_name.trim()
        : driverFullName;
  }

  // 3) Crée (ou réactive) la relation merchant_drivers en `pending`.
  // Si le couple existe déjà :
  //   - blocked → on refuse (le commerçant a explicitement bloqué).
  //   - active  → no-op (déjà actif, code-resubmit sans effet).
  //   - pending → idem, on attend la décision commerçant.
  const { data: existingLink } = await admin
    .from("merchant_drivers")
    .select("status")
    .eq("merchant_id", refRow.merchant_id)
    .eq("driver_id", driverId)
    .maybeSingle();

  if (existingLink) {
    if (existingLink.status === "blocked") {
      return NextResponse.json(
        { error: "blocked_by_merchant" },
        { status: 403 }
      );
    }
    return NextResponse.json({
      ok: true,
      status: existingLink.status,
      already_linked: true,
    });
  }

  const { error: linkErr } = await admin.from("merchant_drivers").insert({
    merchant_id: refRow.merchant_id,
    driver_id: driverId,
    status: "pending",
  });
  if (linkErr) {
    return NextResponse.json(
      { error: `link_failed:${linkErr.message}` },
      { status: 500 }
    );
  }

  // Log audit (côté merchant_driver_events, attribuable au livreur).
  await admin.from("merchant_driver_events").insert({
    merchant_id: refRow.merchant_id,
    driver_id: driverId,
    actor_email: user.email ?? null,
    action: "request_submitted",
    note: null,
  });

  // Push FCM au commerçant.
  void notifyMerchantNewDriverRequest({
    merchantId: refRow.merchant_id,
    driverFullName,
  });

  return NextResponse.json({
    ok: true,
    status: "pending",
    already_linked: false,
  });
}
