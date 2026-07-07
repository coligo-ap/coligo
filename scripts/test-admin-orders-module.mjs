// Test e2e des RPC du module Gestion avancée des commandes (0337-0338) —
// admin_search_orders / admin_compensate_driver / admin_refund_customer — via
// des SESSIONS RÉELLES (authenticated) : valide GRANT EXECUTE par rôle + les
// gardes admin_can par domaine (staff pilotage OK, marketing/anon/non-admin
// rejetés). Données temporaires nettoyées en finally.
//
// Lancement : node scripts/test-admin-orders-module.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(ROOT, ".env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^\\s*" + k + "\\s*=\\s*(.*)\\s*$", "m"));
  let v = m ? m[1] : "";
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  return v;
};
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = "admin-e2e-" + Date.now() + "@coligo.test";
const password = "AdmE2E-" + Date.now() + "!";
let uid = null;
let uid2 = null;

try {
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (uErr) throw new Error("createUser: " + uErr.message);
  uid = u.user.id;
  const { error: paErr } = await admin
    .from("platform_admins")
    .insert({ email, role: "staff", domains: ["pilotage"], is_active: true });
  if (paErr) throw new Error("platform_admins: " + paErr.message);

  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await sb.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error("signin: " + sErr.message);

  const { data: rows, error: rpcErr } = await sb.rpc("admin_search_orders", {
    p_limit: 3,
  });
  console.log(
    rpcErr
      ? "❌ search staff pilotage: " + rpcErr.message
      : "✅ search staff pilotage: " +
          rows.length +
          " lignes, total=" +
          (rows[0] ? rows[0].total_count : 0)
  );

  const { data: comp, error: cErr } = await sb.rpc("admin_compensate_driver", {
    p_order_id: "00000000-0000-0000-0000-000000000000",
    p_driver_id: "00000000-0000-0000-0000-000000000000",
    p_amount_da: 100,
    p_note: "test",
  });
  console.log(
    cErr
      ? "❌ compensate EXECUTE: " + cErr.message
      : "✅ compensate accessible, garde métier: " + JSON.stringify(comp)
  );

  const { data: ref, error: rErr } = await sb.rpc("admin_refund_customer", {
    p_order_id: "00000000-0000-0000-0000-000000000000",
    p_amount_da: 100,
    p_note: "test",
  });
  console.log(
    rErr
      ? "❌ refund EXECUTE: " + rErr.message
      : "✅ refund accessible, garde métier: " + JSON.stringify(ref)
  );

  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: aErr } = await anonC.rpc("admin_search_orders", {
    p_limit: 1,
  });
  console.log(
    aErr ? "✅ anon rejeté: " + aErr.message : "❌ anon NON rejeté !"
  );

  const email2 = "user-e2e-" + Date.now() + "@coligo.test";
  const { data: u2 } = await admin.auth.admin.createUser({
    email: email2,
    password,
    email_confirm: true,
  });
  uid2 = u2.user.id;
  const sb2 = createClient(URL, ANON, { auth: { persistSession: false } });
  await sb2.auth.signInWithPassword({ email: email2, password });
  const { data: r2, error: e2 } = await sb2.rpc("admin_search_orders", {
    p_limit: 3,
  });
  console.log(
    e2
      ? "non-admin erreur: " + e2.message
      : r2.length === 0
        ? "✅ non-admin authentifié: 0 ligne (fail-closed)"
        : "❌ non-admin voit " + r2.length + " lignes !"
  );

  // Staff HORS domaine (marketing) → fail-closed aussi
  const email3 = "staff-mkt-e2e-" + Date.now() + "@coligo.test";
  const { data: u3 } = await admin.auth.admin.createUser({
    email: email3,
    password,
    email_confirm: true,
  });
  await admin
    .from("platform_admins")
    .insert({
      email: email3,
      role: "staff",
      domains: ["marketing"],
      is_active: true,
    });
  const sb3 = createClient(URL, ANON, { auth: { persistSession: false } });
  await sb3.auth.signInWithPassword({ email: email3, password });
  const { data: r3 } = await sb3.rpc("admin_search_orders", { p_limit: 3 });
  const { data: c3 } = await sb3.rpc("admin_compensate_driver", {
    p_order_id: "00000000-0000-0000-0000-000000000000",
    p_driver_id: "00000000-0000-0000-0000-000000000000",
    p_amount_da: 100,
    p_note: "test",
  });
  console.log(
    (r3 ?? []).length === 0 && c3?.reason === "forbidden"
      ? "✅ staff marketing: search vide + compensate forbidden"
      : "❌ staff marketing PASSE: " + JSON.stringify({ r3, c3 })
  );
  await admin.from("platform_admins").delete().eq("email", email3);
  await admin.auth.admin.deleteUser(u3.user.id);
} finally {
  await admin.from("platform_admins").delete().eq("email", email);
  if (uid) await admin.auth.admin.deleteUser(uid);
  if (uid2) await admin.auth.admin.deleteUser(uid2);
  console.log("--- nettoyage OK ---");
}
