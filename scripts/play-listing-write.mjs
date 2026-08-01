// =============================================================================
// Fiche Google Play — rédaction complète (titre, description courte, longue).
//
// Contraintes Play, respectées à la lettre : titre ≤ 30, description courte
// ≤ 80, description longue ≤ 4000 caractères. Play REFUSE l'édition au-delà,
// on vérifie donc AVANT d'envoyer plutôt que de se faire jeter à la validation.
//
// Écriture pensée pour le référencement de la boutique : les mots que les gens
// TAPENT (livraison, courses, supérette, restaurant, VTC, taxi, wilaya…)
// apparaissent naturellement dans les premières lignes — c'est ce que Play
// indexe — sans empilement de mots-clés, qui est sanctionné.
//
// Lancer : node scripts/play-listing-write.mjs [--dry]
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";
const DRY = process.argv.includes("--dry");

const LISTINGS = {
  "fr-FR": {
    title: "Coligo : livraison & Drive",
    shortDescription:
      "Courses, repas et trajets en Algérie. Livraison suivie, prix connu d'avance.",
    fullDescription: `Coligo réunit dans une seule application ce que vous faites tous les jours : commander chez vos commerçants, vous faire livrer, vous déplacer et payer.

━━━━━━━━━━━━━━━━━━━━
COMMANDER PRÈS DE CHEZ VOUS
━━━━━━━━━━━━━━━━━━━━
Supérettes, boulangeries, restaurants, pâtisseries, parapharmacies : les commerces de votre commune, avec leurs vrais prix et leur stock du jour.

• Retrait sur place gratuit, ou livraison à votre adresse
• Le total s'affiche avant de payer : produits, frais de service, livraison
• Paiement en espèces à la livraison ou en ligne par carte
• Suivi en direct, du commerçant jusqu'à votre porte

━━━━━━━━━━━━━━━━━━━━
COLIGO DRIVE — VOS TRAJETS
━━━━━━━━━━━━━━━━━━━━
Un chauffeur pour vos déplacements en ville, et vos longs trajets entre wilayas.

• Le prix est connu AVANT de réserver — aucune surprise à l'arrivée
• Choisissez votre confort : Économique, Confort ou Van
• Suivez le véhicule en temps réel, partagez votre trajet à un proche
• Contacts d'urgence accessibles pendant la course

━━━━━━━━━━━━━━━━━━━━
COLIGO PAY — VOTRE PORTEFEUILLE
━━━━━━━━━━━━━━━━━━━━
Rechargez, payez, envoyez.

• Rechargement par carte, virement CCP, ou en espèces chez un agent agréé
• Paiement par QR chez les commerçants partenaires
• Code PIN personnel : chaque opération est confirmée par vous seul

━━━━━━━━━━━━━━━━━━━━
PENSÉE POUR L'ALGÉRIE
━━━━━━━━━━━━━━━━━━━━
• Application en français, en arabe et en anglais
• Espèces acceptées partout — vous n'êtes jamais obligé de payer en ligne
• Prix en dinars, sans conversion ni frais cachés
• Fonctionne même avec une connexion faible

━━━━━━━━━━━━━━━━━━━━
VOUS ÊTES PROFESSIONNEL ?
━━━━━━━━━━━━━━━━━━━━
Commerçant, livreur, chauffeur ou agent Coligo Pay : chaque métier a son espace. Inscrivez-vous depuis l'application et développez votre activité avec nous.

Des questions ? Écrivez-nous depuis l'application, rubrique Aide.`,
  },
  ar: {
    title: "كوليغو: توصيل ونقل",
    shortDescription:
      "تسوّق، وجبات وتنقّل في الجزائر. توصيل متتبَّع وسعر معروف مسبقًا.",
    fullDescription: `يجمع كوليغو في تطبيق واحد ما تحتاجه كل يوم: الطلب من تجّار حيّك، التوصيل، التنقّل والدفع.

━━━━━━━━━━━━━━━━━━━━
اطلب من قرب منزلك
━━━━━━━━━━━━━━━━━━━━
محلات، مخابز، مطاعم، حلويات وشبه صيدليات — تجّار بلديتك بأسعارهم الحقيقية ومخزون اليوم.

• استلام مجاني من المحل، أو توصيل إلى عنوانك
• المجموع يظهر قبل الدفع: المنتجات، رسوم الخدمة والتوصيل
• الدفع نقدًا عند الاستلام أو عبر البطاقة
• تتبّع مباشر من المحل إلى بابك

━━━━━━━━━━━━━━━━━━━━
كوليغو درايف — تنقّلاتك
━━━━━━━━━━━━━━━━━━━━
سائق لتنقّلاتك داخل المدينة، ولرحلاتك الطويلة بين الولايات.

• السعر معروف قبل الحجز — لا مفاجآت عند الوصول
• اختر راحتك: اقتصادي، مريح أو فان
• تابع السيارة مباشرة وشارك رحلتك مع أحد أقاربك
• أرقام الطوارئ في متناولك أثناء الرحلة

━━━━━━━━━━━━━━━━━━━━
كوليغو باي — محفظتك
━━━━━━━━━━━━━━━━━━━━
عبّئ، ادفع، أرسل.

• التعبئة بالبطاقة، أو تحويل CCP، أو نقدًا لدى وكيل معتمد
• الدفع برمز QR لدى التجّار الشركاء
• رمز سري خاص بك: كل عملية تؤكّدها أنت وحدك

━━━━━━━━━━━━━━━━━━━━
مصمَّم للجزائر
━━━━━━━━━━━━━━━━━━━━
• التطبيق بالعربية والفرنسية والإنجليزية
• النقد مقبول في كل مكان — لست مجبرًا على الدفع عبر الإنترنت
• الأسعار بالدينار، بدون تحويل ولا رسوم خفية
• يعمل حتى مع اتصال ضعيف

━━━━━━━━━━━━━━━━━━━━
هل أنت محترف؟
━━━━━━━━━━━━━━━━━━━━
تاجر، موصّل، سائق أو وكيل كوليغو باي: لكل مهنة فضاؤها. سجّل من التطبيق وطوّر نشاطك معنا.

عندك سؤال؟ راسلنا من التطبيق، قسم المساعدة.`,
  },
  "en-US": {
    title: "Coligo: delivery & rides",
    shortDescription:
      "Groceries, meals and rides in Algeria. Tracked delivery, price known upfront.",
    fullDescription: `Coligo brings together in one app what you do every day: order from local shops, get it delivered, get around, and pay.

━━━━━━━━━━━━━━━━━━━━
ORDER FROM SHOPS NEAR YOU
━━━━━━━━━━━━━━━━━━━━
Grocery stores, bakeries, restaurants, pastry shops and pharmacies — the shops in your own commune, with their real prices and today's stock.

• Free pickup in store, or delivery to your address
• The total is shown before you pay: items, service fee, delivery
• Pay cash on delivery, or online by card
• Live tracking, from the shop to your door

━━━━━━━━━━━━━━━━━━━━
COLIGO DRIVE — YOUR RIDES
━━━━━━━━━━━━━━━━━━━━
A driver for city trips, and for long journeys between wilayas.

• The price is known BEFORE you book — no surprise on arrival
• Pick your comfort: Economy, Comfort or Van
• Follow the vehicle live, share your trip with someone close
• Emergency contacts reachable during the ride

━━━━━━━━━━━━━━━━━━━━
COLIGO PAY — YOUR WALLET
━━━━━━━━━━━━━━━━━━━━
Top up, pay, send.

• Top up by card, CCP transfer, or cash at an approved agent
• Pay by QR code at partner shops
• Personal PIN: every operation is confirmed by you alone

━━━━━━━━━━━━━━━━━━━━
BUILT FOR ALGERIA
━━━━━━━━━━━━━━━━━━━━
• Available in French, Arabic and English
• Cash accepted everywhere — you are never forced to pay online
• Prices in dinars, no conversion and no hidden fees
• Works even on a weak connection

━━━━━━━━━━━━━━━━━━━━
ARE YOU A PROFESSIONAL?
━━━━━━━━━━━━━━━━━━━━
Merchant, courier, driver or Coligo Pay agent: every trade has its own space. Sign up from the app and grow your business with us.

Questions? Write to us from the app, Help section.`,
  },
};

// Garde-fou : Play refuse au-delà des limites — autant le voir ici.
let bad = false;
for (const [lang, l] of Object.entries(LISTINGS)) {
  const checks = [
    ["titre", l.title.length, 30],
    ["court", l.shortDescription.length, 80],
    ["long", l.fullDescription.length, 4000],
  ];
  for (const [name, len, max] of checks) {
    const ok = len <= max;
    if (!ok) bad = true;
    console.log(
      `${lang} ${name.padEnd(6)} ${String(len).padStart(4)}/${max} ${ok ? "ok" : "TROP LONG"}`
    );
  }
}
if (bad) process.exit(1);
if (DRY) {
  console.log("\nEssai à blanc — rien envoyé.");
  process.exit(0);
}

const sa = JSON.parse(
  readFileSync(resolve(root, "play-service-account.json"), "utf8")
);
const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
const { token } = await auth.getAccessToken();
const H = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

const edit = await (
  await fetch(`${base}/edits`, { method: "POST", headers: H })
).json();
console.log(`\nÉdition ${edit.id} ouverte`);

for (const [lang, l] of Object.entries(LISTINGS)) {
  const res = await fetch(`${base}/edits/${edit.id}/listings/${lang}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ language: lang, ...l }),
  });
  const j = await res.json();
  if (!res.ok) {
    console.error(`${lang} refusé :`, JSON.stringify(j).slice(0, 300));
    await fetch(`${base}/edits/${edit.id}`, { method: "DELETE", headers: H });
    process.exit(1);
  }
  console.log(`${lang} : fiche écrite`);
}

const commit = await (
  await fetch(`${base}/edits/${edit.id}:commit`, { method: "POST", headers: H })
).json();
console.log(
  commit.id
    ? "✅ Fiche Play publiée."
    : `Refus : ${JSON.stringify(commit).slice(0, 300)}`
);
