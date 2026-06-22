// k6 — contention sur la déduction wallet (anti double-spend / solde négatif).
// STAGING UNIQUEMENT. Voir scripts/k6/README.md.
//
// Tire N transferts concurrents depuis le MÊME wallet de test, chacun avec un
// client_operation_id distinct, montant > (solde / N) pour forcer la contention :
// au plus floor(solde/montant) doivent réussir, les autres doivent être refusés
// proprement (insufficient_funds), JAMAIS un solde négatif ni un succès en trop.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL;
const ANON = __ENV.SUPABASE_ANON;
const SENDER_TOKEN = __ENV.AUTH_TOKEN; // JWT du wallet émetteur de test
const RECEIVER_HANDLE = __ENV.RECEIVER_HANDLE; // @handle ou tél du destinataire de test
const AMOUNT = Number(__ENV.AMOUNT || 1000);

const ok = new Counter("transfer_ok");
const refused = new Counter("transfer_refused");
const unexpected = new Counter("transfer_unexpected_error");

export const options = {
  scenarios: {
    burst: {
      executor: "shared-iterations",
      vus: 50,
      iterations: 200,
      maxDuration: "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    transfer_unexpected_error: ["count==0"],
  },
};

export default function () {
  const opId = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/coligo_pay_transfer`,
    JSON.stringify({
      p_receiver: RECEIVER_HANDLE,
      p_amount_da: AMOUNT,
      p_client_operation_id: opId,
      p_pin: __ENV.PIN,
    }),
    {
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${SENDER_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  const txt = res.body || "";
  if (res.status === 200) ok.add(1);
  else if (/insufficient|insuffisant|solde/i.test(txt)) refused.add(1);
  else unexpected.add(1);
  check(res, { "pas de 5xx": (r) => r.status < 500 });
}
// Post-run : SELECT operator_balance / customer_topup_balance du wallet émetteur
// >= 0, et nb de succès * AMOUNT <= solde initial. Sinon double-spend.
