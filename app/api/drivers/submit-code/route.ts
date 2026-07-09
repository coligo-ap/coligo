import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDriverGate } from "@/lib/auth/driver-gate";
import { hashReferralCode } from "@/lib/drivers/referral-code";
import { notifyMerchantNewDriverRequest } from "@/lib/fcm/triggers";

/**
 * POST /api/drivers/submit-code — un livreur soumet un code de référence.
 *
 * Endpoint historique (l'interface passe par la server action `driverSubmitCode`).
 * Il reste exposé, donc il applique EXACTEMENT les mêmes règles : rejoindre un
 * commerçant est une fonctionnalité opérationnelle, réservée aux comptes
 * vérifiés par l'équipe Coligo. Un livreur en cours d'inscription reçoit un 403,
 * et le trigger `merchant_drivers_verified_guard_trg` (mig 0352) refuserait de
 * toute façon l'insertion.
 *
 * Le code en clair NE part jamais en log — on log seulement le hash et
 * le résultat (accepted/rejected).
 *
 * Payload : { code: "BOUL-K4Q7X9" }
 */

type Body = { code?: unknown };

export async function POST(req: Request) {
  const ssr = await createClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Source de vérité : l'étape du parcours, relue en base à chaque appel.
  const gate = await getDriverGate();
  if (!gate) {
    return NextResponse.json({ error: "not_a_driver" }, { status: 403 });
  }
  if (gate.isBlocked || gate.stage !== "active") {
    return NextResponse.json(
      { error: "account_not_verified" },
      { status: 403 }
    );
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

  // 2) Profil livreur : il existe forcément (le gate l'a résolu). Plus aucune
  //    création paresseuse ici — un compte livreur naît uniquement du parcours
  //    d'inscription, jamais d'un appel d'API.
  const driverId = gate.id;
  const driverFullName = gate.fullName;

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
