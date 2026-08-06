/**
 * BALAYAGE A→Z des ESPACES PARTENAIRES en prod : connexion RÉELLE sur chaque
 * portail (comptes de test — mdp = identifiant, jamais modifiés) puis
 * chargement de chaque page de l'espace. Signale : HTTP ≥ 400, crash de rendu,
 * pageerror console, corps vide. Les REDIRECTIONS sont notées (⚠) sans être
 * des échecs : les gardes d'état (vérification, abonnement…) sont légitimes.
 *
 *   BASE_URL=https://coligo-liart.vercel.app node scripts/_partner-qa-sweep.mjs
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PHONE = "0603044618";
// Agent QA TEMPORAIRE (créé/supprimé par le script — on ne touche pas aux
// comptes réels, leurs mots de passe sont inconnus/immuables).
const QA_AGENT_PHONE = "0699000042";
// Convention d'auth partenaire (lib/auth/phone-identity) : email SYNTHÉTIQUE
// = chiffres E.164 @partners.coligo.local — le login téléphone le reconstruit.
const QA_AGENT_EMAIL = `213${QA_AGENT_PHONE.slice(1)}@partners.coligo.local`;
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const SPACES = [
  {
    name: "LIVREUR (Ali)",
    login: "/driver/login",
    id: PHONE,
    idSelector: 'input[type="tel"]',
    routes: [
      "/driver",
      "/driver/gains",
      "/driver/historique",
      "/driver/tournees",
      "/driver/abonnement",
      "/driver/codes",
      "/driver/documents",
      "/driver/identite",
      "/driver/notifications",
      "/driver/parametres",
      "/driver/recharger",
      "/driver/recharger/historique",
      "/driver/recharger/methode",
      "/driver/releve",
      "/driver/telecharger",
    ],
  },
  {
    name: "CHAUFFEUR (Said)",
    login: "/chauffeur/login",
    id: PHONE,
    idSelector: 'input[type="tel"]',
    routes: [
      "/chauffeur",
      "/chauffeur/demandes",
      "/chauffeur/gains",
      "/chauffeur/historique",
      "/chauffeur/abonnement",
      "/chauffeur/compte",
      "/chauffeur/releve",
      "/chauffeur/recharger",
      "/chauffeur/recharger/historique",
      "/chauffeur/course",
      "/chauffeur/documents",
      "/chauffeur/identite",
    ],
  },
  {
    name: "AGENT (QA temporaire)",
    login: "/partenaire/login",
    id: QA_AGENT_PHONE,
    idSelector: 'input[type="tel"]',
    routes: [
      "/partenaire",
      "/partenaire/vendre",
      "/partenaire/historique",
      "/partenaire/recharger",
      "/partenaire/dossier",
      "/partenaire/aide",
    ],
  },
  {
    name: "COMMERÇANT (Supérette Yemma Gouraya, seed)",
    login: "/login",
    id: "superette-yemma-gouraya@dz.coligo.app",
    password: "coligo2026", // mot de passe du seed (scripts/seed-merchants-dz)
    idSelector: 'input[type="email"]',
    routes: [
      "/dashboard",
      "/orders",
      "/catalog",
      "/catalog/new",
      "/promotions",
      "/finances",
      "/livreurs",
      "/livraison/creneaux",
      "/encaisser",
      "/settings",
      "/stats",
      "/recharger",
      "/aide",
      "/identite",
    ],
  },
];

// ── Agent QA temporaire : auth user (mdp = téléphone, convention comptes de
// test) + portefeuille partner ACTIF minimal. Supprimé à la fin.
let qaAgentUserId = null;
async function setupQaAgent() {
  const { data: created, error } = await sb.auth.admin.createUser({
    email: QA_AGENT_EMAIL,
    password: QA_AGENT_PHONE,
    phone: `+213${QA_AGENT_PHONE.slice(1)}`,
    email_confirm: true,
    phone_confirm: true,
  });
  if (error && !/already/i.test(error.message)) throw error;
  if (created?.user) qaAgentUserId = created.user.id;
  if (!qaAgentUserId) {
    const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
    qaAgentUserId =
      list.users.find((u) => u.email === QA_AGENT_EMAIL)?.id ?? null;
    if (qaAgentUserId)
      await sb.auth.admin.updateUserById(qaAgentUserId, {
        password: QA_AGENT_PHONE,
      });
  }
  // Portefeuille partner actif minimal (insert ; s'il existe déjà d'un run
  // précédent interrompu, on le réactive).
  const row = {
    owner_type: "partner",
    owner_id: qaAgentUserId,
    display_name: "QA Sweep Kiosque",
    owner_name: "QA",
    phone: QA_AGENT_PHONE,
    status: "active",
    is_verified: true,
  };
  const ins = await sb.from("operator_wallets").insert(row);
  if (ins.error) {
    const upd = await sb
      .from("operator_wallets")
      .update(row)
      .eq("owner_id", qaAgentUserId);
    if (upd.error)
      throw new Error(`wallet QA: ${ins.error.message} / ${upd.error.message}`);
  }
}
async function cleanupQaAgent() {
  try {
    await sb.from("operator_wallets").delete().eq("owner_id", qaAgentUserId);
  } catch {
    /* best effort */
  }
  if (qaAgentUserId) await sb.auth.admin.deleteUser(qaAgentUserId);
}

const browser = await chromium.launch();
let totalBad = 0;
await setupQaAgent();

for (const space of SPACES) {
  console.log(`\n═══ ${space.name} ═══`);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  let errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));

  try {
    await page.goto(`${BASE}${space.login}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForTimeout(2500);
    await page.fill(space.idSelector, space.id);
    await page.fill('input[type="password"]', space.password ?? space.id);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(9000);
    if (page.url().includes("login") || page.url().includes("se-connecter")) {
      const body = ((await page.textContent("body")) ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 220);
      console.log(`❌ LOGIN ÉCHOUÉ (${page.url()}) — ${body}`);
      totalBad++;
      await ctx.close();
      continue;
    }
    console.log(`connecté → ${new URL(page.url()).pathname}`);
  } catch (e) {
    console.log(`❌ LOGIN: ${e.message.slice(0, 100)}`);
    totalBad++;
    await ctx.close();
    continue;
  }

  for (const path of space.routes) {
    errors = [];
    let status = 0;
    try {
      const resp = await page.goto(`${BASE}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      status = resp?.status() ?? 0;
      await page.waitForTimeout(2200);
    } catch (e) {
      console.log(`❌ ${path} — navigation: ${e.message.slice(0, 80)}`);
      totalBad++;
      continue;
    }
    const body = (
      (await page.textContent("body").catch(() => "")) ?? ""
    ).replace(/\s+/g, " ");
    const problems = [];
    if (status >= 400) problems.push(`HTTP ${status}`);
    if (/Application error/i.test(body)) problems.push("crash rendu");
    if (body.length < 150) problems.push(`corps ${body.length} car.`);
    if (errors.length) problems.push(errors[0]);
    const finalPath = new URL(page.url()).pathname;
    const note = finalPath !== path ? ` (→ ${finalPath})` : "";
    console.log(
      `${problems.length ? "❌" : "✅"} ${path}${note}${problems.length ? " — " + problems.join(" ; ") : ""}`
    );
    if (problems.length) totalBad++;
  }
  await ctx.close();
}

await browser.close();
await cleanupQaAgent();
console.log("agent QA supprimé");
console.log(`\n===== BILAN PARTENAIRES : ${totalBad} problème(s) =====`);
process.exit(totalBad ? 1 : 0);
