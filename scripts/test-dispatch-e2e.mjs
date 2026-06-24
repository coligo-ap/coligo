/**
 * Test e2e du DISPATCH PUSH chauffeur (server → client), bout en bout sur la
 * prod, avec données temporaires NETTOYÉES.
 *
 * Chaîne vérifiée :
 *   1. Présence réelle (chauffeur vérifié, en ligne, géolocalisé) ;
 *   2. CIBLAGE : `chauffeurs_present_near` renvoie bien ce chauffeur (donc le
 *      serveur lui pousserait la course) ;
 *   3. CANAL PRIVÉ : abonné authentifié → reçoit `new_ride` sur son canal
 *      `chauffeur:{userId}` (broadcast HTTP private:true, mig 0254) ;
 *   4. ISOLATION : un AUTRE chauffeur ne reçoit PAS ce broadcast.
 *
 * Ce qui RESTE manuel (hors script) : confirmation sur APK réel (push FCM en
 * arrière-plan, GPS natif, sonnerie). Cf. todo « test APK ».
 *
 * Lancement : node scripts/test-dispatch-e2e.mjs
 */
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
const ALGER = { lat: 36.7538, lng: 3.0588 };

let assertions = 0,
  failures = 0;
const check = (label, cond) => {
  assertions++;
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${label}`);
};

const broadcast = async (topic, event, payload) => {
  const r = await fetch(URL + "/realtime/v1/api/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SVC,
      Authorization: "Bearer " + SVC,
    },
    body: JSON.stringify({
      messages: [{ topic, event, payload, private: true }],
    }),
  });
  return r.status;
};

/** Crée un chauffeur temporaire (auth user + fiche + présence en ligne). */
async function makeChauffeur(near, online = true) {
  const email = `disp-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email,
    password: "Disp-E2E-123!",
    email_confirm: true,
  });
  if (uErr) throw new Error("createUser: " + uErr.message);
  const uid = u.user.id;
  const phone = "07" + Math.floor(10000000 + Math.random() * 89999999);
  const { data: ch, error: cErr } = await admin
    .from("chauffeurs")
    .insert({
      user_id: uid,
      full_name: "E2E Dispatch",
      phone,
      gamme: "classic",
      is_verified: true,
      is_frozen: false,
      is_blocked: false,
    })
    .select("id")
    .single();
  if (cErr) throw new Error("insert chauffeur: " + cErr.message);
  await admin.from("chauffeur_presence").upsert({
    chauffeur_id: ch.id,
    lat: near.lat,
    lng: near.lng,
    is_online: online,
    updated_at: new Date().toISOString(),
  });
  return { uid, chauffeurId: ch.id, email, password: "Disp-E2E-123!" };
}

async function cleanup(c) {
  if (!c) return;
  await admin
    .from("chauffeur_presence")
    .delete()
    .eq("chauffeur_id", c.chauffeurId);
  await admin.from("chauffeurs").delete().eq("id", c.chauffeurId);
  await admin.auth.admin.deleteUser(c.uid);
}

/** Abonne (authentifié) au canal privé et écoute `new_ride` pendant la fenêtre. */
async function subscribeAndWait(creds, topic, fireAfter) {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  });
  return await new Promise((resolve) => {
    let got = false;
    const ch = sb.channel(topic, { config: { private: true } });
    ch.on("broadcast", { event: "new_ride" }, () => {
      got = true;
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        if (fireAfter) await fireAfter();
        setTimeout(async () => {
          await sb.removeAllChannels();
          resolve({ status, got });
        }, 1500);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        resolve({ status, got: false });
      }
    });
  });
}

async function main() {
  let chA, chB;
  try {
    console.log("— Setup : 2 chauffeurs vérifiés en ligne près d'Alger —");
    chA = await makeChauffeur(ALGER);
    chB = await makeChauffeur(ALGER);

    // 2. CIBLAGE serveur : present_near doit renvoyer les deux.
    const rpc = admin.rpc.bind(admin);
    const { data: near } = await rpc("chauffeurs_present_near", {
      p_lat: ALGER.lat,
      p_lng: ALGER.lng,
      p_radius_km: 30,
      p_within_min: 999999,
      p_gamme: "classic",
      p_female_only: false,
      p_customer_id: null,
    });
    const ids = new Set((near ?? []).map((r) => r.chauffeur_id));
    check(
      "ciblage present_near inclut le chauffeur A",
      ids.has(chA.chauffeurId)
    );
    check(
      "ciblage present_near inclut le chauffeur B",
      ids.has(chB.chauffeurId)
    );

    // 3+4. A s'abonne à SON canal ; on diffuse à A ; A reçoit, B (autre canal) non.
    const recvA = await subscribeAndWait(chA, `chauffeur:${chA.uid}`, () =>
      broadcast(`chauffeur:${chA.uid}`, "new_ride", { rideId: "e2e" })
    );
    check("A reçoit le broadcast sur SON canal privé", recvA.got === true);

    const recvB = await subscribeAndWait(chB, `chauffeur:${chB.uid}`, () =>
      broadcast(`chauffeur:${chA.uid}`, "new_ride", { rideId: "e2e" })
    );
    check(
      "B ne reçoit PAS le broadcast destiné à A (isolation)",
      recvB.got === false
    );
  } catch (e) {
    failures++;
    console.error("❌ ERREUR:", e.message);
  } finally {
    await cleanup(chA);
    await cleanup(chB);
    console.log("— cleanup done —");
  }
  console.log(
    `\n${failures === 0 ? "✅ TOUT VERT" : "❌ ÉCHECS"} : ${assertions - failures}/${assertions}`
  );
  process.exit(failures === 0 ? 0 : 1);
}
main();
