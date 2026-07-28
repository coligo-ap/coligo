// =============================================================================
// Fiche Play multilingue + titre à mots-clés (ASO) — app.coligo.client.
//   node scripts/play-listing-i18n.mjs          → applique et COMMIT l'édition
//
// Pourquoi : la fiche n'existait qu'en fr-FR avec le titre nu « Coligo ».
// Pour la recherche Play en Algérie : titre à mots-clés (« livraison &
// courses ») + fiches AR (langue majoritaire des recherches) et EN. Les
// descriptions fr existantes sont conservées telles quelles.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";
const key = JSON.parse(
  readFileSync(resolve(root, "play-service-account.json"), "utf8")
);
const jwt = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
const { token } = await jwt.getAccessToken();
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${url}\n→ HTTP ${res.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

const edit = await api("POST", `${base}/edits`);
const eid = edit.id;

// Fiche FR existante (descriptions conservées, seul le TITRE gagne des mots-clés).
const fr = await api("GET", `${base}/edits/${eid}/listings/fr-FR`);

const TITLE_FR = "Coligo : livraison & courses";
const TITLE_AR = "كوليغو — توصيل ومشتريات";
const TITLE_EN = "Coligo: Delivery in Algeria";

const SHORT_AR =
  "توصيل الطعام والمشتريات من المتاجر القريبة — ادفع نقدًا أو إلكترونيًا.";
const FULL_AR = `كوليغو هو تطبيق التوصيل الجزائري: اطلب وجباتك ومشترياتك من المتاجر والمطاعم القريبة منك، وتابع طلبك مباشرة حتى باب منزلك.

• توصيل سريع من المطاعم، البيتزيريات، السوبيرات، المخابز، الصيدليات والمزيد
• الدفع كما يناسبك: نقدًا عند الاستلام، أو إلكترونيًا بالبطاقة الذهبية EDAHABIA وبطاقة CIB
• كوليغو درايف: مشاوير بسيارة أو دراجة نارية بأسعار واضحة
• كوليغو باي: محفظة رقمية للدفع بالمسح السريع QR واسترجاع كاش باك على طلباتك
• عروض وتخفيضات يومية من التجار المحليين
• تتبّع مباشر للطلب والموصّل على الخريطة
• واجهة كاملة بالعربية، وبالفرنسية والإنجليزية

كوليغو يدعم التجار المحليين في كل ولايات الجزائر: كل طلب منك يساعد متجر حيّك.

حمّل التطبيق الآن واطلب في دقائق!`;

const SHORT_EN =
  "Food & grocery delivery from local shops in Algeria. Pay cash or online.";
const FULL_EN = `Coligo is Algeria's local delivery app: order meals and groceries from restaurants and shops near you, and track your order live to your door.

• Fast delivery from restaurants, pizzerias, superettes, bakeries, pharmacies and more
• Pay your way: cash on delivery, or online with EDAHABIA and CIB cards
• Coligo Drive: car and moto rides at clear prices
• Coligo Pay: a wallet for QR payments and cashback on your orders
• Daily deals and promos from local merchants
• Live tracking of your order and courier on the map
• Full interface in Arabic, French and English

Coligo supports local merchants across all of Algeria — every order helps a neighbourhood shop.

Download now and order in minutes!`;

// FR : titre à mots-clés, descriptions inchangées.
await api("PUT", `${base}/edits/${eid}/listings/fr-FR`, {
  language: "fr-FR",
  title: TITLE_FR,
  shortDescription: fr.shortDescription,
  fullDescription: fr.fullDescription,
  video: fr.video ?? undefined,
});
console.log(`fr-FR : titre → « ${TITLE_FR} » (descriptions conservées)`);

await api("PUT", `${base}/edits/${eid}/listings/ar`, {
  language: "ar",
  title: TITLE_AR,
  shortDescription: SHORT_AR,
  fullDescription: FULL_AR,
});
console.log(`ar    : fiche créée (« ${TITLE_AR} »)`);

await api("PUT", `${base}/edits/${eid}/listings/en-US`, {
  language: "en-US",
  title: TITLE_EN,
  shortDescription: SHORT_EN,
  fullDescription: FULL_EN,
});
console.log(`en-US : fiche créée (« ${TITLE_EN} »)`);

await api("POST", `${base}/edits/${eid}:commit`);
console.log(
  "✔ Édition COMMITÉE — fiches envoyées à Google (revue éventuelle)."
);
