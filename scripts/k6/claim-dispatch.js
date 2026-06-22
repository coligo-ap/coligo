// k6 — contention sur le claim de dispatch (un seul gagnant attendu).
// STAGING UNIQUEMENT. Voir scripts/k6/README.md.
//
// Simule N livreurs qui appellent en parallèle pull_next_express_nearby :
// la propriété attendue est qu'une commande donnée n'est attribuée qu'à UN seul
// livreur (claim atomique FOR UPDATE SKIP LOCKED). On mesure la latence et on
// compte les attributions dupliquées détectées via les réponses.
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL;
const ANON = __ENV.SUPABASE_ANON;
// Liste de JWT de livreurs de test staging, séparés par des virgules.
const DRIVER_TOKENS = (__ENV.DRIVER_TOKENS || "").split(",").filter(Boolean);

const claimLatency = new Trend("claim_latency", true);
const doubleAssign = new Counter("double_assign_suspected");
const claimedIds = {}; // order_id -> nb d'attributions (doit rester 1)

export const options = {
  scenarios: {
    rush: {
      executor: "per-vu-iterations",
      vus: Math.max(DRIVER_TOKENS.length, 50),
      iterations: 20,
      maxDuration: "2m",
    },
  },
  thresholds: {
    claim_latency: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    double_assign_suspected: ["count==0"],
  },
};

export default function () {
  const token = DRIVER_TOKENS[(__VU - 1) % DRIVER_TOKENS.length] || ANON;
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/pull_next_express_nearby`,
    JSON.stringify({ p_lat: 36.75, p_lng: 3.06, p_radius_km: 5 }),
    {
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
  claimLatency.add(res.timings.duration);
  check(res, { "status 200": (r) => r.status === 200 });
  try {
    const body = res.json();
    const id = Array.isArray(body) ? body[0]?.order_id : body?.order_id;
    if (id) {
      claimedIds[id] = (claimedIds[id] || 0) + 1;
      if (claimedIds[id] > 1) doubleAssign.add(1); // même commande rendue 2× = bug claim
    }
  } catch (_) {}
}
