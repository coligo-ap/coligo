#!/usr/bin/env node
/**
 * Seed des CHAUFFEURS DE DÉMO Coligo Drive (11 comptes, 4 villes) —
 * permet de tester : femme conductrice, filtrage des gammes, partage de
 * trajet, contacts d'urgence, SOS, paiement/PIN, annulation/remboursement.
 *
 *   node scripts/seed-drive-chauffeurs.mjs
 *
 * Idempotent (clé = téléphone). Mot de passe = téléphone (règle des comptes
 * de test). Notes différentes via des courses terminées notées (client démo
 * dédié), distances/disponibilités variées via chauffeur_presence.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnvLocal() {
  let content;
  try {
    content = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    )
      val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnvLocal();

const CITIES = {
  alger: { lat: 36.7538, lng: 3.0588 },
  bejaia: { lat: 36.7509, lng: 5.0567 },
  lille: { lat: 50.6292, lng: 3.0573 },
  roubaix: { lat: 50.6927, lng: 3.1746 },
};

/** Répartition : H/F, Classic/Confort/Moto, notes et distances différentes. */
const DRIVERS = [
  // Alger
  {
    first: "Ahmed",
    last: "B.",
    city: "Alger",
    base: "alger",
    phone: "0550100001",
    gamme: "classic",
    female: false,
    rating: 4.9,
    ratings: [5, 5, 5, 4, 5, 5, 5, 5, 5, 5],
    dKm: 0.8,
    online: true,
    vehicle: ["Hyundai", "i10", "Grise", "00111-119-16"],
  },
  {
    first: "Yasmine",
    last: "K.",
    city: "Alger",
    base: "alger",
    phone: "0550100002",
    gamme: "classic",
    female: true,
    rating: 4.8,
    ratings: [5, 5, 4, 5, 5, 4, 5, 5],
    dKm: 1.6,
    online: true,
    vehicle: ["Renault", "Clio", "Bleue", "00222-120-16"],
  },
  {
    first: "Samir",
    last: "M.",
    city: "Alger",
    base: "alger",
    phone: "0550100003",
    gamme: "confort",
    female: false,
    rating: 4.6,
    ratings: [5, 4, 5, 4, 5, 4, 5],
    dKm: 2.7,
    online: true,
    vehicle: ["VW", "Tiguan", "Noire", "00333-121-16"],
  },
  {
    first: "Sarah",
    last: "A.",
    city: "Alger",
    base: "alger",
    phone: "0550100004",
    gamme: "confort",
    female: true,
    rating: 5.0,
    ratings: [5, 5, 5, 5, 5, 5],
    dKm: 3.5,
    online: false,
    vehicle: ["Peugeot", "3008", "Blanche", "00444-122-16"],
  },
  // Béjaïa
  {
    first: "Karim",
    last: "H.",
    city: "Béjaïa",
    base: "bejaia",
    phone: "0550100005",
    gamme: "classic",
    female: false,
    rating: 4.7,
    ratings: [5, 4, 5, 5, 4, 5, 5, 4],
    dKm: 1.1,
    online: true,
    vehicle: ["Kia", "Picanto", "Rouge", "00555-123-06"],
  },
  {
    first: "Lydia",
    last: "T.",
    city: "Béjaïa",
    base: "bejaia",
    phone: "0550100006",
    gamme: "confort",
    female: true,
    rating: 4.9,
    ratings: [5, 5, 5, 5, 4, 5, 5, 5, 5],
    dKm: 2.2,
    online: true,
    vehicle: ["Toyota", "Corolla", "Grise", "00666-124-06"],
  },
  {
    first: "Nassim",
    last: "C.",
    city: "Béjaïa",
    base: "bejaia",
    phone: "0550100007",
    gamme: "moto",
    female: false,
    rating: 4.5,
    ratings: [5, 4, 4, 5, 4, 5],
    dKm: 0.6,
    online: false,
    vehicle: ["Yamaha", "NMax", "Noire", "00777-125-06"],
  },
  // Lille
  {
    first: "Thomas",
    last: "D.",
    city: "Lille",
    base: "lille",
    phone: "0550100008",
    gamme: "confort",
    female: false,
    rating: 4.8,
    ratings: [5, 5, 4, 5, 5, 5, 4, 5],
    dKm: 1.9,
    online: true,
    vehicle: ["Peugeot", "508", "Bleue", "AB-123-CD"],
  },
  {
    first: "Julie",
    last: "R.",
    city: "Lille",
    base: "lille",
    phone: "0550100009",
    gamme: "classic",
    female: true,
    rating: 4.7,
    ratings: [5, 4, 5, 5, 4, 5],
    dKm: 3.1,
    online: true,
    vehicle: ["Renault", "Zoé", "Blanche", "EF-456-GH"],
  },
  // Roubaix
  {
    first: "Mehdi",
    last: "L.",
    city: "Roubaix",
    base: "roubaix",
    phone: "0550100010",
    gamme: "moto",
    female: false,
    rating: 4.4,
    ratings: [5, 4, 4, 4, 5, 4],
    dKm: 0.9,
    online: true,
    vehicle: ["Honda", "PCX", "Grise", "IJ-789-KL"],
  },
  {
    first: "Sonia",
    last: "B.",
    city: "Roubaix",
    base: "roubaix",
    phone: "0550100011",
    gamme: "classic",
    female: true,
    rating: 4.6,
    ratings: [5, 4, 5, 4, 5, 4, 5],
    dKm: 2.4,
    online: false,
    vehicle: ["Dacia", "Sandero", "Beige", "MN-012-OP"],
  },
];

/** Dossiers EN ATTENTE (file de validation admin) : docs placeholder inclus. */
const PENDING_DRIVERS = [
  {
    first: "Walid",
    last: "Z.",
    city: "Alger",
    base: "alger",
    phone: "0550100012",
    gamme: "classic",
    female: false,
    vehicle: ["Seat", "Ibiza", "Grise", "00888-126-16"],
    docs: ["permis_recto", "permis_verso", "carte_grise", "plaque", "selfie"],
  },
  {
    first: "Amina",
    last: "G.",
    city: "Béjaïa",
    base: "bejaia",
    phone: "0550100013",
    gamme: "confort",
    female: true,
    vehicle: ["Hyundai", "Tucson", "Noire", "00999-127-06"],
    docs: [
      "permis_recto",
      "permis_verso",
      "carte_grise",
      "plaque",
      "selfie",
      "assurance",
    ],
  },
];

const DOC_LABELS = {
  permis_recto: "PERMIS (RECTO)",
  permis_verso: "PERMIS (VERSO)",
  carte_grise: "CARTE GRISE",
  plaque: "PLAQUE",
  selfie: "SELFIE",
  assurance: "ASSURANCE",
};

/** Placeholder SVG lisible (aperçu admin) pour un document de démo. */
function placeholderSvg(title, name) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
  <rect width="640" height="400" fill="#EEEEFD"/>
  <rect x="20" y="20" width="600" height="360" rx="18" fill="#fff" stroke="#5B5BE6" stroke-width="3"/>
  <text x="320" y="170" text-anchor="middle" font-family="Arial" font-size="34" font-weight="bold" fill="#5B5BE6">${title}</text>
  <text x="320" y="225" text-anchor="middle" font-family="Arial" font-size="22" fill="#0B0C12">${name} — document de DÉMO</text>
  <text x="320" y="265" text-anchor="middle" font-family="Arial" font-size="16" fill="#6B7280">Pièce factice pour tester la validation super admin</text>
</svg>`,
    "utf8"
  );
}

async function seedPending(supa, db) {
  for (const d of PENDING_DRIVERS) {
    const email = `${d.phone}@chauffeurs.coligo.local`;
    const fullName = `${d.first} ${d.last}`;
    const dup = await db.query("SELECT id FROM chauffeurs WHERE phone=$1", [
      d.phone,
    ]);
    let chId = dup.rows[0]?.id;
    if (!chId) {
      const { data: authData, error: authErr } =
        await supa.auth.admin.createUser({
          email,
          password: d.phone,
          email_confirm: true,
        });
      let userId = authData?.user?.id;
      if (authErr) {
        const { data: list } = await supa.auth.admin.listUsers({
          perPage: 1000,
        });
        userId = list?.users?.find((u) => u.email === email)?.id;
        if (!userId) throw new Error(`auth ${email}: ${authErr.message}`);
      }
      const ins = await db.query(
        `INSERT INTO chauffeurs (user_id, full_name, first_name, phone, city, wilaya,
           gamme, is_female, is_female_verified, is_verified, submitted_at, is_demo,
           vehicle_make, vehicle_model, vehicle_color, vehicle_plate, birth_date)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$7,false,now(),true,$8,$9,$10,$11,'1995-09-03')
         RETURNING id`,
        [
          userId,
          fullName,
          d.first,
          d.phone,
          d.city,
          d.gamme,
          d.female,
          d.vehicle[0],
          d.vehicle[1],
          d.vehicle[2],
          d.vehicle[3],
        ]
      );
      chId = ins.rows[0].id;
    }
    // Documents placeholder (statut 'pending' → file de validation).
    for (const kind of d.docs) {
      const existing = await db.query(
        "SELECT id FROM chauffeur_documents WHERE chauffeur_id=$1 AND kind=$2",
        [chId, kind]
      );
      if (existing.rows[0]) continue;
      const path = `chauffeur/${chId}/${kind}-demo.svg`;
      const { error: upErr } = await supa.storage
        .from("driver-docs")
        .upload(path, placeholderSvg(DOC_LABELS[kind], fullName), {
          contentType: "image/svg+xml",
          upsert: true,
        });
      if (upErr && !String(upErr.message).includes("exists"))
        throw new Error(`upload ${kind}: ${upErr.message}`);
      await db.query(
        "INSERT INTO chauffeur_documents (chauffeur_id, kind, url) VALUES ($1,$2,$3) ON CONFLICT (chauffeur_id, kind) DO NOTHING",
        [chId, kind, path]
      );
    }
    console.log(
      `✓ ${fullName.padEnd(12)} ${d.city.padEnd(8)} ${d.gamme.padEnd(8)} ` +
        `${d.female ? "F" : "H"}  DOSSIER EN ATTENTE (${d.docs.length} pièces)  tél/mdp: ${d.phone}`
    );
  }
}

const DEMO_CLIENT_EMAIL = "demo.drive.client@coligo.local";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_SERVICE_ROLE_KEY / URL manquants (.env.local)");
  const supa = createClient(url, key, { auth: { persistSession: false } });
  const db = new pg.Client({ connectionString: getDbUrl() });
  await db.connect();

  // Client démo (porteur des courses notées — n'apparaît chez aucun vrai client).
  let demoCustomerId;
  {
    const { data: list } = await supa.auth.admin.listUsers({ perPage: 1000 });
    let user = list?.users?.find((u) => u.email === DEMO_CLIENT_EMAIL);
    if (!user) {
      const { data, error } = await supa.auth.admin.createUser({
        email: DEMO_CLIENT_EMAIL,
        password: "demo.drive.client",
        email_confirm: true,
      });
      if (error) throw error;
      user = data.user;
      console.log("client démo créé");
    }
    const existing = await db.query(
      "SELECT id FROM customers WHERE user_id=$1",
      [user.id]
    );
    if (existing.rows[0]) demoCustomerId = existing.rows[0].id;
    else {
      const ins = await db.query(
        "INSERT INTO customers (user_id, full_name) VALUES ($1,'Client Démo Drive') RETURNING id",
        [user.id]
      );
      demoCustomerId = ins.rows[0].id;
    }
  }

  let created = 0;
  for (const d of DRIVERS) {
    const email = `${d.phone}@chauffeurs.coligo.local`;
    const fullName = `${d.first} ${d.last}`;

    // Déjà seedé ? (clé = téléphone)
    const dup = await db.query("SELECT id FROM chauffeurs WHERE phone=$1", [
      d.phone,
    ]);
    let chId = dup.rows[0]?.id;

    if (!chId) {
      // 1. Compte auth (mot de passe = téléphone — règle des comptes de test).
      const { data: authData, error: authErr } =
        await supa.auth.admin.createUser({
          email,
          password: d.phone,
          email_confirm: true,
        });
      let userId = authData?.user?.id;
      if (authErr) {
        const { data: list } = await supa.auth.admin.listUsers({
          perPage: 1000,
        });
        userId = list?.users?.find((u) => u.email === email)?.id;
        if (!userId) throw new Error(`auth ${email}: ${authErr.message}`);
      }

      // 2. Profil chauffeur VÉRIFIÉ (dossier validé) + véhicule + gamme.
      const ins = await db.query(
        `INSERT INTO chauffeurs (user_id, full_name, first_name, phone, city, wilaya,
           gamme, is_female, is_female_verified, is_verified, verified_at, submitted_at, is_demo,
           vehicle_make, vehicle_model, vehicle_color, vehicle_plate, birth_date)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$7,true,now(),now(),true,$8,$9,$10,$11,'1992-05-12')
         RETURNING id`,
        [
          userId,
          fullName,
          d.first,
          d.phone,
          d.city,
          d.gamme,
          d.female,
          d.vehicle[0],
          d.vehicle[1],
          d.vehicle[2],
          d.vehicle[3],
        ]
      );
      chId = ins.rows[0].id;
      created++;
    }

    // 3. Présence : distances et disponibilités différentes (offset ~dKm).
    const base = CITIES[d.base];
    const lat = base.lat + d.dKm / 111;
    const lng = base.lng + d.dKm / 90;
    await db.query(
      `INSERT INTO chauffeur_presence (chauffeur_id, lat, lng, is_online, updated_at)
       VALUES ($1,$2,$3,$4, CASE WHEN $4 THEN now() ELSE now() - interval '2 hours' END)
       ON CONFLICT (chauffeur_id) DO UPDATE
         SET lat=$2, lng=$3, is_online=$4,
             updated_at = CASE WHEN $4 THEN now() ELSE now() - interval '2 hours' END`,
      [chId, lat, lng, d.online]
    );

    // 4. Notes différentes : courses terminées notées par le client démo.
    const { rows: rated } = await db.query(
      "SELECT count(*)::int n FROM rides WHERE chauffeur_id=$1 AND chauffeur_rating IS NOT NULL",
      [chId]
    );
    if (rated[0].n === 0) {
      for (let i = 0; i < d.ratings.length; i++) {
        const price = 200 + ((i * 37) % 240);
        const com = Math.round(price * 0.08);
        await db.query(
          `INSERT INTO rides (customer_id, chauffeur_id, status,
             pickup_lat, pickup_lng, pickup_text, dest_lat, dest_lng, dest_text,
             distance_km, suggested_price_da, proposed_price_da, agreed_price_da,
             payment_method, gamme, chauffeur_rating, commission_rate_applied,
             commission_da, chauffeur_net_da,
             created_at, accepted_at, started_at, completed_at)
           VALUES ($1,$2,'completed',$3,$4,'Centre-ville',$5,$6,'Quartier ${i + 1}',
             $7,$8,$8,$8,'cash',$9,$10,0.08,$11,$12,
             now() - interval '${(i + 2) * 26} hours',
             now() - interval '${(i + 2) * 26} hours' + interval '4 minutes',
             now() - interval '${(i + 2) * 26} hours' + interval '9 minutes',
             now() - interval '${(i + 2) * 26} hours' + interval '24 minutes')`,
          [
            demoCustomerId,
            chId,
            base.lat,
            base.lng,
            base.lat + 0.02,
            base.lng + 0.02,
            3 + (i % 5),
            price,
            d.gamme,
            d.ratings[i],
            com,
            price - com,
          ]
        );
      }
    }
    console.log(
      `✓ ${fullName.padEnd(12)} ${d.city.padEnd(8)} ${d.gamme.padEnd(8)} ${d.female ? "F (vérifiée)" : "H"}  ` +
        `★${d.rating}  ${d.dKm} km  ${d.online ? "EN LIGNE" : "hors ligne"}  tél/mdp: ${d.phone}`
    );
  }

  // Dossiers EN ATTENTE pour la file de validation super admin.
  await seedPending(supa, db);

  // Rattrapage : tous les comptes de démo sont marqués is_demo (répondeur).
  await db.query(
    "UPDATE chauffeurs SET is_demo=true WHERE phone LIKE '05501000%'"
  );

  // Vérification finale.
  const check = await db.query(
    `SELECT c.first_name, c.gamme, c.is_female_verified,
            round(avg(r.chauffeur_rating)::numeric,1) AS note, p.is_online
     FROM chauffeurs c
     LEFT JOIN rides r ON r.chauffeur_id = c.id AND r.chauffeur_rating IS NOT NULL
     LEFT JOIN chauffeur_presence p ON p.chauffeur_id = c.id
     WHERE c.phone LIKE '05501000%'
     GROUP BY c.id, c.first_name, c.gamme, c.is_female_verified, p.is_online
     ORDER BY c.phone`
  );
  console.log("\nÉtat en base :");
  for (const r of check.rows)
    console.log(
      ` ${String(r.first_name).padEnd(8)} ${String(r.gamme).padEnd(8)} ` +
        `${r.is_female_verified ? "F" : "H"}  ★${r.note}  ${r.is_online ? "online" : "offline"}`
    );
  console.log(`\n${created} chauffeur(s) créé(s), ${DRIVERS.length} au total.`);
  await db.end();
}

main().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
