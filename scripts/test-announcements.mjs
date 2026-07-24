// =============================================================================
// Tests de non-régression — ANNONCES ADMIN (mig 0408)
// =============================================================================
// Transaction ROLLBACK sur la prod (claims JWT simulées) :
//   A. SÉCURITÉ DE CIBLAGE : un CLIENT ne voit JAMAIS une annonce commerçants ;
//      un COMMERÇANT la voit. Filtres : brouillon, désactivée, expirée,
//      programmée (future), canal push-seul → invisibles en pop-up.
//   B. Non-bloquante : disparaît dès `seen`. Bloquante : persiste après `seen`,
//      disparaît après `ack` (ou clic).
//   C. Reçus IDEMPOTENTS forward-only : rejouer seen/ack/click ne crée rien,
//      n'écrase rien, ne jette jamais (file offline rejouable).
//   D. CHECK : bloquante sans bouton REFUSÉE ; audience invalide REFUSÉE.
//   E. Stats admin exactes (impressions / acquittées / clics par bouton).
//   F. ANON : tout refusé.
// Usage : node scripts/test-announcements.mjs
// =============================================================================

import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

const client = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
function assert(cond, label, detail) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  await client.connect();
  const cust = (
    await client.query(
      "select user_id from customers where user_id is not null limit 1"
    )
  ).rows[0];
  const merch = (
    await client.query(
      "select user_id from merchants where user_id is not null limit 1"
    )
  ).rows[0];
  const adminEmail = (
    await client.query(
      "select email from platform_admins where is_active and (role='owner' or 'marketing' = any(domains)) limit 1"
    )
  ).rows[0]?.email;
  if (!cust || !merch || !adminEmail) {
    console.error("Fixtures manquantes (client, commerçant, admin marketing).");
    process.exit(1);
  }

  const asUser = (uid) =>
    client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ]);

  await client.query("BEGIN");
  try {
    // ── Fixtures d'annonces (insérées en service, comme la console) ──
    const mk = async (over = {}) => {
      const base = {
        status: "published",
        title_fr: "T",
        title_ar: "ت",
        body_fr: "B",
        body_ar: "ب",
        audiences: "{merchant}",
        channel: "both",
        popup_mode: "next_open",
        blocking: false,
        buttons: "[]",
      };
      const row = { ...base, ...over };
      return (
        await client.query(
          `insert into announcements
             (status, title_fr, title_ar, body_fr, body_ar, audiences, channel,
              popup_mode, blocking, buttons, starts_at, ends_at, disabled_at)
           values ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10::jsonb,
                   coalesce($11::timestamptz, now()), $12::timestamptz, $13::timestamptz)
           returning id`,
          [
            row.status,
            row.title_fr,
            row.title_ar,
            row.body_fr,
            row.body_ar,
            row.audiences,
            row.channel,
            row.popup_mode,
            row.blocking,
            row.buttons,
            row.starts_at ?? null,
            row.ends_at ?? null,
            row.disabled_at ?? null,
          ]
        )
      ).rows[0].id;
    };

    const annMerchant = await mk(); // publiée, commerçants
    await mk({ status: "draft" });
    await mk({ disabled_at: new Date().toISOString() });
    await mk({ ends_at: new Date(Date.now() - 3600e3).toISOString() });
    await mk({ starts_at: new Date(Date.now() + 3600e3).toISOString() });
    await mk({ channel: "push" }); // push seule → jamais en pop-up
    const annBlocking = await mk({
      audiences: "{merchant}",
      blocking: true,
      buttons: JSON.stringify([
        { label_fr: "J'ai compris", label_ar: "فهمت", action: "acknowledge" },
        {
          label_fr: "Voir",
          label_ar: "عرض",
          action: "redirect_internal",
          target: "/dashboard",
        },
      ]),
    });

    // =========================================================================
    console.log("TEST A — ciblage par rôle + filtres");
    // =========================================================================
    await asUser(cust.user_id);
    let list = (await client.query("select public.my_announcements() j"))
      .rows[0].j;
    assert(
      Array.isArray(list) && list.length === 0,
      "A1 CLIENT : ZÉRO annonce commerçants visible (sécurité centrale)",
      JSON.stringify(list)
    );

    await asUser(merch.user_id);
    list = (await client.query("select public.my_announcements() j")).rows[0].j;
    const ids = list.map((a) => a.id);
    assert(
      ids.includes(annMerchant) &&
        ids.includes(annBlocking) &&
        list.length === 2,
      "A2 COMMERÇANT : voit exactement les 2 publiées actives (ni brouillon, ni désactivée, ni expirée, ni future, ni push-seule)",
      JSON.stringify(ids)
    );
    assert(
      list[0].id === annBlocking,
      "A3 la BLOQUANTE passe en tête de file",
      list[0]?.id
    );

    // =========================================================================
    console.log("TEST B — vue vs acquittée (normale / bloquante)");
    // =========================================================================
    let r = (
      await client.query(
        "select public.announcement_receipt($1, 'seen', null) j",
        [annMerchant]
      )
    ).rows[0].j;
    assert(r.ok === true, "B1 reçu `seen` accepté", JSON.stringify(r));
    await client.query("select public.announcement_receipt($1, 'seen', null)", [
      annBlocking,
    ]);
    list = (await client.query("select public.my_announcements() j")).rows[0].j;
    assert(
      list.length === 1 && list[0].id === annBlocking,
      "B2 normale disparue après `seen` ; BLOQUANTE toujours là",
      JSON.stringify(list.map((a) => a.id))
    );

    r = (
      await client.query(
        "select public.announcement_receipt($1, 'click', 0) j",
        [annBlocking]
      )
    ).rows[0].j;
    list = (await client.query("select public.my_announcements() j")).rows[0].j;
    assert(
      r.ok === true && list.length === 0,
      "B3 bloquante disparue après CLIC (bouton 0)",
      JSON.stringify(list)
    );

    // =========================================================================
    console.log("TEST C — idempotence forward-only (file offline)");
    // =========================================================================
    const before = (
      await client.query(
        "select * from announcement_receipts where announcement_id=$1 and user_id=$2",
        [annBlocking, merch.user_id]
      )
    ).rows[0];
    for (let i = 0; i < 3; i++) {
      await client.query("select public.announcement_receipt($1, 'click', 1)", [
        annBlocking,
      ]);
      await client.query(
        "select public.announcement_receipt($1, 'ack', null)",
        [annBlocking]
      );
      await client.query(
        "select public.announcement_receipt($1, 'seen', null)",
        [annBlocking]
      );
    }
    const after = (
      await client.query(
        "select * from announcement_receipts where announcement_id=$1 and user_id=$2",
        [annBlocking, merch.user_id]
      )
    ).rows[0];
    const count = (
      await client.query(
        "select count(*)::int n from announcement_receipts where announcement_id=$1",
        [annBlocking]
      )
    ).rows[0].n;
    assert(
      count === 1 &&
        after.clicked_button === before.clicked_button &&
        String(after.seen_at) === String(before.seen_at) &&
        String(after.clicked_at) === String(before.clicked_at),
      "C1 rejeux : 1 seule ligne, clic/seen d'origine JAMAIS écrasés (forward-only)",
      `n=${count} btn=${after.clicked_button}`
    );
    r = (
      await client.query(
        "select public.announcement_receipt($1, 'seen', null) j",
        ["00000000-0000-0000-0000-000000000000"]
      )
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "not_targeted",
      "C2 reçu sur annonce inconnue → refus PROPRE (jamais d'exception)",
      JSON.stringify(r)
    );
    // Un CLIENT ne peut pas accuser une annonce commerçants.
    await asUser(cust.user_id);
    r = (
      await client.query(
        "select public.announcement_receipt($1, 'ack', null) j",
        [annMerchant]
      )
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "not_targeted",
      "C3 reçu d'un client sur une annonce commerçants → refusé",
      JSON.stringify(r)
    );

    // =========================================================================
    console.log("TEST D — contraintes de schéma");
    // =========================================================================
    let blocked = false;
    try {
      await client.query("SAVEPOINT d1");
      await mk({ blocking: true, buttons: "[]" });
    } catch {
      blocked = true;
      await client.query("ROLLBACK TO SAVEPOINT d1");
    }
    assert(blocked, "D1 bloquante SANS bouton refusée (CHECK)");
    blocked = false;
    try {
      await client.query("SAVEPOINT d2");
      await mk({ audiences: "{aliens}" });
    } catch {
      blocked = true;
      await client.query("ROLLBACK TO SAVEPOINT d2");
    }
    assert(blocked, "D2 audience inconnue refusée (CHECK)");

    // =========================================================================
    console.log("TEST E — stats admin");
    // =========================================================================
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ email: adminEmail, role: "authenticated" }),
    ]);
    const stats = (
      await client.query("select public.admin_announcement_stats($1) j", [
        annBlocking,
      ])
    ).rows[0].j;
    assert(
      stats.impressions === 1 && stats.clicks_0 === 1 && stats.clicks_1 === 0,
      "E1 stats : 1 impression, 1 clic bouton 0, 0 clic bouton 1",
      JSON.stringify(stats)
    );
  } finally {
    await client.query("ROLLBACK");
  }
  await client.end();

  // ===========================================================================
  console.log("TEST F — accès ANON");
  // ===========================================================================
  loadEnvLocal();
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  for (const [fn, args] of [
    ["my_announcements", {}],
    [
      "announcement_receipt",
      {
        p_id: "00000000-0000-0000-0000-000000000000",
        p_event: "seen",
        p_button: null,
      },
    ],
    [
      "admin_announcement_stats",
      { p_id: "00000000-0000-0000-0000-000000000000" },
    ],
    ["announcements_due_push", {}],
  ]) {
    const { error } = await anon.rpc(fn, args);
    assert(!!error, `F1 ${fn} REFUSÉE en anon`);
  }

  console.log(
    failures === 0
      ? "\n✅ Tous les tests annonces passent."
      : `\n❌ ${failures} échec(s).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
