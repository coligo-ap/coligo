// k6 — brute-force / rate-limit de la validation pickupCode.
// STAGING UNIQUEMENT. Voir scripts/k6/README.md.
//
// Le pickupCode est unique par merchant_id sur la fenêtre active (4-5 chiffres).
// On simule un commerçant authentifié qui tente en boucle des codes aléatoires :
// la propriété attendue est qu'on ne valide JAMAIS une commande au hasard
// (échecs propres, idéalement rate-limit après N essais), pas de 5xx, pas de
// fuite d'info distinguant « code inexistant » de « code d'un autre commerçant ».
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL;
const ANON = __ENV.SUPABASE_ANON;
const MERCHANT_TOKEN = __ENV.AUTH_TOKEN; // JWT commerçant de test staging

const accidentalHit = new Counter("accidental_validation"); // doit rester 0
const rateLimited = new Counter("rate_limited");

export const options = {
  scenarios: {
    bruteforce: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 50,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.5"], // beaucoup de 4xx attendus, pas de 5xx
    accidental_validation: ["count==0"],
    "http_req_duration{status:500}": ["count==0"],
  },
};

export default function () {
  const code = String(Math.floor(1000 + Math.random() * 9000)); // 4 chiffres
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/validate_pickup_code`,
    JSON.stringify({ p_code: code }),
    {
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${MERCHANT_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (res.status === 429) rateLimited.add(1);
  if (res.status === 200 && /order_id|completed|ok/i.test(res.body || ""))
    accidentalHit.add(1);
  check(res, { "pas de 5xx": (r) => r.status < 500 });
}
