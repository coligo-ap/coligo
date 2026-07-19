// =============================================================================
// Paiements internationaux EUR (diaspora) — moteur taux + éligibilité + audit
// =============================================================================
// Règles produit (18/07/2026) :
//   - le taux de change (1 EUR = X DA) ne SORT JAMAIS de ce module vers le
//     client final : seuls le montant EUR final (sur la page Stripe) et des
//     booléens d'éligibilité sont exposés ;
//   - taux 'auto' = marché parallèle observé (scrape fail-soft, snapshots en
//     DB) − marge admin (défaut 30 DA), borné plancher/plafond de sanité ;
//   - taux 'manual' = imposé par le super-admin, effet immédiat, prioritaire ;
//   - AUCUN taux résolvable ⇒ option coupée (fail-closed : on n'invente
//     jamais un taux) ;
//   - visibilité par PAYS (header Vercel x-vercel-ip-country) + plafonds
//     par commande / client / plateforme (intl_caps_usage, mig 0376).
// Tout passe par le client service_role : les tables intl_* n'ont AUCUNE
// policy RLS. Chaque appelant est une server action auth-gardée, une page
// admin (requireAdminDomain) ou le webhook Stripe (signature vérifiée).
// =============================================================================

import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeAnyKeyPresent } from "@/lib/payments/stripe";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type IntlDomain = "drive" | "marketplace" | "wallet";

export type IntlSettings = {
  enabled: boolean;
  /** Sous-drapeaux par domaine (mig 0385/0389) — le global `enabled` maître. */
  enabled_drive: boolean;
  enabled_marketplace: boolean;
  enabled_wallet: boolean;
  allowed_countries: string[];
  rate_mode: "auto" | "manual";
  manual_rate_da: number | null;
  auto_margin_da: number;
  rate_floor_da: number;
  rate_ceiling_da: number;
  per_order_min_eur_cents: number;
  per_order_max_eur_cents: number;
  per_user_day_eur_cents: number;
  per_user_month_eur_cents: number;
  platform_day_eur_cents: number;
  platform_month_eur_cents: number;
  paypal_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
};

export type EffectiveRate = { rate_da: number; source: string };

export type IntlRefusal =
  | "off" // coupé (kill-switch global, clés absentes, flag online)
  | "domain_off" // rail € coupé POUR CE domaine (drive / marketplace)
  | "country" // pays non autorisé
  | "rate" // aucun taux résolvable
  | "order_min"
  | "order_max"
  | "user_day"
  | "user_month"
  | "capacity"; // plafond plateforme (jour ou mois)

export type IntlEligibility =
  | {
      ok: true;
      rate: EffectiveRate;
      eur_cents: number | null;
      paypal_enabled: boolean;
    }
  | { ok: false; reason: IntlRefusal };

type Admin = ReturnType<typeof createAdminClient>;

// Casts localisés : les tables intl_* (mig 0376) ne sont pas dans
// database.types.ts généré (Docker requis) — même pattern que feature-flags.
function tbl(admin: Admin, name: string) {
  return (admin.from as unknown as (t: string) => never)(name) as unknown as {
    select: (cols: string) => {
      eq: (
        c: string,
        v: unknown
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
      order: (
        c: string,
        o: { ascending: boolean }
      ) => {
        limit: (n: number) => Promise<{
          data: Record<string, unknown>[] | null;
        }>;
      };
    };
    insert: (
      row: Record<string, unknown>
    ) => Promise<{ error: { code?: string; message: string } | null }>;
    update: (row: Record<string, unknown>) => {
      eq: (
        c: string,
        v: unknown
      ) => Promise<{ error: { message: string } | null }>;
    };
    upsert: (
      row: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Réglages (singleton id=true)
// ─────────────────────────────────────────────────────────────────────────────
export async function getIntlSettings(admin: Admin): Promise<IntlSettings> {
  const { data } = await tbl(admin, "intl_payment_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    enabled: d.enabled === true,
    // Défaut TRUE (colonnes NOT NULL DEFAULT true) : un réglage absent n'a pas
    // pour effet de couper un domaine par surprise.
    enabled_drive: d.enabled_drive !== false,
    enabled_marketplace: d.enabled_marketplace !== false,
    // Nouveauté OFF par défaut (colonne DEFAULT false).
    enabled_wallet: d.enabled_wallet === true,
    allowed_countries: Array.isArray(d.allowed_countries)
      ? (d.allowed_countries as string[])
      : [],
    rate_mode: d.rate_mode === "manual" ? "manual" : "auto",
    manual_rate_da: d.manual_rate_da == null ? null : Number(d.manual_rate_da),
    auto_margin_da: Number(d.auto_margin_da ?? 30),
    rate_floor_da: Number(d.rate_floor_da ?? 150),
    rate_ceiling_da: Number(d.rate_ceiling_da ?? 400),
    per_order_min_eur_cents: Number(d.per_order_min_eur_cents ?? 500),
    per_order_max_eur_cents: Number(d.per_order_max_eur_cents ?? 30000),
    per_user_day_eur_cents: Number(d.per_user_day_eur_cents ?? 30000),
    per_user_month_eur_cents: Number(d.per_user_month_eur_cents ?? 80000),
    platform_day_eur_cents: Number(d.platform_day_eur_cents ?? 100000),
    platform_month_eur_cents: Number(d.platform_month_eur_cents ?? 200000),
    paypal_enabled: d.paypal_enabled === true,
    updated_by: (d.updated_by as string | null) ?? null,
    updated_at: (d.updated_at as string) ?? new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Taux du marché parallèle — CHAÎNE MULTI-SOURCES fail-soft + snapshots DB
// ─────────────────────────────────────────────────────────────────────────────
// Pas d'API officielle du parallèle → on interroge PLUSIEURS sites publics de
// cotations « Square Port-Saïd », chacun avec SON parseur ciblé (structure
// vérifiée le 18/07/2026, valeurs croisées cohérentes : 275/277-280 DA/€).
// La première source qui répond avec un taux plausible gagne ; le nom de la
// source gagnante est tracé dans le snapshot. Une source qui casse ne coupe
// rien : la suivante prend le relais, et les snapshots amortissent le tout.
// On prend la valeur ACHAT (la plus basse) : base honnête avant marge.
//
// Sanité absolue du parse (indépendante des réglages admin) : hors de cette
// fourchette, c'est un bug de parse, pas un taux.
const PARSE_MIN = 120;
const PARSE_MAX = 500;
const SNAPSHOT_FRESH_MS = 6 * 60 * 60 * 1000; // 6 h

function plausible(v: number): boolean {
  return Number.isFinite(v) && v >= PARSE_MIN && v <= PARSE_MAX;
}

type RateSource = {
  name: string;
  url: string;
  parse: (html: string) => number | null;
};

const RATE_SOURCES: RateSource[] = [
  {
    // JSON-LD schema.org : {"currency":"EUR","currentExchangeRate":{"price":275,…}}
    // — le plus robuste (données structurées, pas de markup fragile).
    name: "squareportsaid",
    url: "https://squareportsaid.com/en/",
    parse: (html) => {
      const m = html.match(
        /"currency"\s*:\s*"EUR"[\s\S]{0,200}?"price"\s*:\s*(\d+(?:\.\d+)?)/
      );
      if (!m) return null;
      const v = Number(m[1]);
      return plausible(v) ? v : null;
    },
  },
  {
    // « <h1>1 EURO</h1> … <h1>280<span>.00</span></h1> … BUY RATE … 277 … SELL »
    // → on capture les deux cours autour du bloc EURO et on prend le min.
    name: "devisesquare",
    url: "https://devisesquare.com/",
    parse: (html) => {
      const i = html.search(/1\s*EURO\b/i);
      if (i < 0) return null;
      const zone = html.slice(i, i + 1200);
      const nums: number[] = [];
      const re = /<h1>(\d{3})(?:<span>\.(\d{1,2})<\/span>)?<\/h1>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(zone)) && nums.length < 2) {
        const v = Number(`${m[1]}.${m[2] ?? "0"}`);
        if (plausible(v)) nums.push(v);
      }
      return nums.length > 0 ? Math.min(...nums) : null;
    },
  },
  {
    // « 1 Euro … = 278 DA … (Achat) … = 280 DA … (Vente) » — cash uniquement
    // (on s'arrête avant les lignes « Euro Visa »).
    name: "vikizia",
    url: "https://vikizia.com/devise.php",
    parse: (html) => {
      const nums: number[] = [];
      const re =
        /1\s*Euro\s*(?!Visa)[\s\S]{0,120}?=\s*(\d{3}(?:[.,]\d{1,2})?)\s*DA/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && nums.length < 2) {
        const v = Number(m[1].replace(",", "."));
        if (plausible(v)) nums.push(v);
      }
      return nums.length > 0 ? Math.min(...nums) : null;
    },
  },
];

async function fetchOne(
  src: RateSource
): Promise<{ ok: true; rate: number } | { ok: false; note: string }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(src.url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColigoRate/1.0)" },
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, note: `HTTP ${res.status}` };
    const rate = src.parse(await res.text());
    if (rate == null) return { ok: false, note: "parse impossible" };
    return { ok: true, rate };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "fetch échoué" };
  }
}

async function fetchParallelRate(): Promise<
  { ok: true; rate: number; source: string } | { ok: false; note: string }
> {
  const failures: string[] = [];
  for (const src of RATE_SOURCES) {
    const r = await fetchOne(src);
    if (r.ok) return { ok: true, rate: r.rate, source: src.name };
    failures.push(`${src.name}: ${r.note}`);
  }
  return { ok: false, note: failures.join(" | ") };
}

type Snapshot = { raw_rate_da: number; fetched_at: string };

async function latestOkSnapshot(admin: Admin): Promise<Snapshot | null> {
  const { data } = await tbl(admin, "intl_rate_snapshots")
    .select("raw_rate_da, fetched_at, ok")
    .order("fetched_at", { ascending: false })
    .limit(25);
  for (const row of data ?? []) {
    if (row.ok === true && row.raw_rate_da != null) {
      return {
        raw_rate_da: Number(row.raw_rate_da),
        fetched_at: String(row.fetched_at),
      };
    }
  }
  return null;
}

/** Taux parallèle courant : snapshot frais (< 6 h) > re-fetch (tracé) >
 *  dernier snapshot connu quel que soit son âge (fail-soft) > null.
 *  `networkFetch=false` (chemin chaud du checkout, simple visibilité) :
 *  n'appelle JAMAIS le réseau tant qu'un snapshot existe — seul le paiement
 *  réel (autoritaire) rafraîchit un snapshot périmé. */
async function currentParallelRate(
  admin: Admin,
  networkFetch: boolean
): Promise<number | null> {
  const last = await latestOkSnapshot(admin);
  if (
    last &&
    Date.now() - new Date(last.fetched_at).getTime() < SNAPSHOT_FRESH_MS
  ) {
    return last.raw_rate_da;
  }
  if (!networkFetch && last) return last.raw_rate_da;
  const fetched = await fetchAndRecordParallelRate(admin);
  if (fetched != null) return fetched;
  return last ? last.raw_rate_da : null;
}

/** Fetch immédiat du marché parallèle + snapshot tracé (succès OU échec —
 *  l'alerte intl_rate_fetch_fail lit ces lignes). Exporté pour le bouton
 *  « Rafraîchir le taux » de l'admin. */
export async function fetchAndRecordParallelRate(
  admin: Admin
): Promise<number | null> {
  const fetched = await fetchParallelRate();
  await tbl(admin, "intl_rate_snapshots").insert({
    source: fetched.ok ? fetched.source : "all-sources",
    raw_rate_da: fetched.ok ? fetched.rate : null,
    ok: fetched.ok,
    note: fetched.ok ? null : fetched.note,
  });
  return fetched.ok ? fetched.rate : null;
}

/** Taux effectif appliqué aux paiements — JAMAIS exposé au client final. */
export async function resolveEffectiveRate(
  admin: Admin,
  settings: IntlSettings,
  opts?: { networkFetch?: boolean }
): Promise<EffectiveRate | null> {
  if (settings.rate_mode === "manual") {
    const r = settings.manual_rate_da;
    if (r != null && r > 0) return { rate_da: r, source: "manual" };
    return null; // mode manuel sans taux saisi = coupé (fail-closed)
  }
  const parallel = await currentParallelRate(
    admin,
    opts?.networkFetch !== false
  );
  if (parallel == null) return null;
  const raw = parallel - settings.auto_margin_da;
  const clamped = Math.min(
    Math.max(raw, settings.rate_floor_da),
    settings.rate_ceiling_da
  );
  return { rate_da: clamped, source: "auto:parallel-market" };
}

/** DA → centimes d'euro, arrondi AU-DESSUS (on ne perd jamais au change). */
export function computeEurCents(totalDa: number, rateDa: number): number {
  return Math.ceil((totalDa * 100) / rateDa);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pays du visiteur (header Vercel) — null si inconnu (dev local)
// ─────────────────────────────────────────────────────────────────────────────
export async function getRequestCountry(): Promise<string | null> {
  // Override de dev : INTL_DEV_COUNTRY=FR dans .env.local pour tester le
  // gating sans être derrière Vercel.
  if (process.env.INTL_DEV_COUNTRY) return process.env.INTL_DEV_COUNTRY;
  try {
    const h = await headers();
    const c = h.get("x-vercel-ip-country");
    return c ? c.toUpperCase() : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit — via admin_audit_log (alimente les alertes super-admin, mig 0376)
// ─────────────────────────────────────────────────────────────────────────────
export async function auditIntl(
  admin: Admin,
  action: string,
  note: string,
  targetId?: string | null
): Promise<void> {
  try {
    await tbl(admin, "admin_audit_log").insert({
      admin_email: "intl",
      action,
      target_kind: "intl_payment",
      target_id: targetId ?? null,
      note,
    });
  } catch (e) {
    console.error("[intl] audit failed:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Éligibilité — vérité UNIQUE, appelée à l'affichage (visibilité) ET à la
// création de session (autoritaire). `totalDa` absent = simple visibilité.
// ─────────────────────────────────────────────────────────────────────────────
export async function checkIntlEligibility(opts: {
  customerId: string;
  totalDa?: number;
  /** Domaine appelant (mig 0385) : le rail € peut être coupé indépendamment
   *  pour Drive ou le Marketplace. Absent = pas de gating par domaine. */
  domain?: IntlDomain;
  /** 'visibility' (défaut si totalDa absent) = chemin chaud : pas de fetch
   *  réseau du taux, pas d'audit capacité. 'authoritative' = création de
   *  session : taux rafraîchi si périmé, capacité auditée. */
  mode?: "visibility" | "authoritative";
}): Promise<IntlEligibility> {
  const admin = createAdminClient();
  const authoritative =
    opts.mode === "authoritative" ||
    (opts.mode == null && opts.totalDa != null);

  // 1. Clés Stripe présentes ? (sans elles, rien n'est proposable)
  if (!stripeAnyKeyPresent()) return { ok: false, reason: "off" };

  // 2. Réglages + kill-switch GLOBAL, puis sous-drapeau du DOMAINE appelant.
  const settings = await getIntlSettings(admin);
  if (!settings.enabled) return { ok: false, reason: "off" };
  if (opts.domain === "drive" && !settings.enabled_drive) {
    return { ok: false, reason: "domain_off" };
  }
  if (opts.domain === "marketplace" && !settings.enabled_marketplace) {
    return { ok: false, reason: "domain_off" };
  }

  // 3. Pays (fail-closed si inconnu, '*' = monde entier)
  const country = await getRequestCountry();
  const allowAll = settings.allowed_countries.includes("*");
  if (
    !allowAll &&
    (!country || !settings.allowed_countries.includes(country))
  ) {
    return { ok: false, reason: "country" };
  }

  // 4. Taux résolvable (réseau uniquement en mode autoritaire)
  const rate = await resolveEffectiveRate(admin, settings, {
    networkFetch: authoritative,
  });
  if (!rate) return { ok: false, reason: "rate" };

  // 5. Plafonds (usage vivant : paid + sessions ouvertes ≤ 35 min)
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data: capsData, error: capsErr } = await rpc("intl_caps_usage", {
    p_customer: opts.customerId,
  });
  if (capsErr) {
    console.error("[intl] caps usage failed:", capsErr.message);
    return { ok: false, reason: "off" }; // fail-closed
  }
  const caps = (Array.isArray(capsData) ? capsData[0] : capsData) as {
    user_day_cents: number;
    user_month_cents: number;
    platform_day_cents: number;
    platform_month_cents: number;
  } | null;
  const usage = {
    userDay: Number(caps?.user_day_cents ?? 0),
    userMonth: Number(caps?.user_month_cents ?? 0),
    platformDay: Number(caps?.platform_day_cents ?? 0),
    platformMonth: Number(caps?.platform_month_cents ?? 0),
  };

  // Capacité plateforme déjà saturée → refus même sans montant (visibilité).
  if (
    usage.platformDay >= settings.platform_day_eur_cents ||
    usage.platformMonth >= settings.platform_month_eur_cents
  ) {
    return { ok: false, reason: "capacity" };
  }

  if (opts.totalDa == null) {
    return {
      ok: true,
      rate,
      eur_cents: null,
      paypal_enabled: settings.paypal_enabled,
    };
  }

  // 6. Montant de CETTE commande
  const eurCents = computeEurCents(opts.totalDa, rate.rate_da);
  if (eurCents < settings.per_order_min_eur_cents) {
    return { ok: false, reason: "order_min" };
  }
  if (eurCents > settings.per_order_max_eur_cents) {
    return { ok: false, reason: "order_max" };
  }
  if (usage.userDay + eurCents > settings.per_user_day_eur_cents) {
    return { ok: false, reason: "user_day" };
  }
  if (usage.userMonth + eurCents > settings.per_user_month_eur_cents) {
    return { ok: false, reason: "user_month" };
  }
  if (
    usage.platformDay + eurCents > settings.platform_day_eur_cents ||
    usage.platformMonth + eurCents > settings.platform_month_eur_cents
  ) {
    // Capacité atteinte AVEC une vraie tentative → tracé (alerte super-admin).
    if (authoritative) {
      await auditIntl(
        admin,
        "intl_capacity_block",
        `Client ${opts.customerId} refusé : commande ${eurCents} c€ dépasse la capacité plateforme.`,
        null
      );
    }
    return { ok: false, reason: "capacity" };
  }

  return {
    ok: true,
    rate,
    eur_cents: eurCents,
    paypal_enabled: settings.paypal_enabled,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Éligibilité RECHARGE PORTEFEUILLE (Coligo Pay) par carte internationale €.
// Centrée sur le PARTENAIRE (pas un client) : pas de plafonds par-client/
// plateforme (anti-fraude diaspora), seulement clés + kill-switch global +
// `enabled_wallet` + pays + taux + borne montant (operator_topup_max_da, DA).
// `totalDa` absent = simple visibilité (pas de fetch réseau du taux).
// ─────────────────────────────────────────────────────────────────────────────
export async function checkWalletIntlEligibility(opts: {
  totalDa?: number;
  mode?: "visibility" | "authoritative";
}): Promise<IntlEligibility> {
  const admin = createAdminClient();
  const authoritative =
    opts.mode === "authoritative" ||
    (opts.mode == null && opts.totalDa != null);

  if (!stripeAnyKeyPresent()) return { ok: false, reason: "off" };
  const settings = await getIntlSettings(admin);
  if (!settings.enabled) return { ok: false, reason: "off" };
  if (!settings.enabled_wallet) return { ok: false, reason: "domain_off" };

  const country = await getRequestCountry();
  const allowAll = settings.allowed_countries.includes("*");
  if (
    !allowAll &&
    (!country || !settings.allowed_countries.includes(country))
  ) {
    return { ok: false, reason: "country" };
  }

  const rate = await resolveEffectiveRate(admin, settings, {
    networkFetch: authoritative,
  });
  if (!rate) return { ok: false, reason: "rate" };

  if (opts.totalDa == null) {
    return { ok: true, rate, eur_cents: null, paypal_enabled: false };
  }

  // Borne montant : min 100 DA, max = plafond de recharge portefeuille (admin).
  const { data: ps } = await tbl(admin, "platform_settings")
    .select("operator_topup_max_da")
    .eq("id", true)
    .maybeSingle();
  const maxDa = Number(
    (ps as { operator_topup_max_da?: number } | null)?.operator_topup_max_da ??
      100000
  );
  if (opts.totalDa < 100) return { ok: false, reason: "order_min" };
  if (opts.totalDa > maxDa) return { ok: false, reason: "order_max" };

  return {
    ok: true,
    rate,
    eur_cents: computeEurCents(opts.totalDa, rate.rate_da),
    paypal_enabled: false,
  };
}
