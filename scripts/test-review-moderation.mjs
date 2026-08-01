// =============================================================================
// Modération des avis — le point d'équilibre à ne pas casser : on refuse
// l'ATTAQUE et la FRAUDE, jamais la colère légitime d'un client mécontent.
// Lancer : npm run test:reviews:moderation
// =============================================================================
import { moderateReview } from "../lib/reviews/moderation.ts";

const CASES = [
  // ── Doivent PASSER : mécontentement légitime, dur mais publiable ────────
  ["", "accept"],
  ["Très bon service, merci", "accept"],
  ["Service catastrophique, livraison en retard", "accept"],
  ["Commande en retard mais correcte", "accept"],
  ["Produits abîmés, je ne recommanderai pas", "accept"],
  ["الخدمة سيئة جدا والتوصيل متأخر", "accept"],
  // ── Insultes (fr, arabe, arabizi, anglais) ─────────────────────────────
  ["fils de pute de commerçant", "reject"],
  ["nique ta mère", "reject"],
  ["يا قحبة", "reject"],
  ["9a7ba", "reject"],
  ["you are retarded", "reject"],
  ["fuck you", "reject"],
  // ── Obfuscation : lettres répétées, séparateurs ────────────────────────
  ["coooonnnard", "reject"],
  ["c.o.n.n.a.r.d", "reject"],
  // ── Coordonnées / démarchage ───────────────────────────────────────────
  ["Appelez-moi au 0555 12 34 56", "reject"],
  ["contactez moi sur whatsapp", "reject"],
  ["visitez www.autresite.dz", "reject"],
  ["ecrivez a moi@exemple.com", "reject"],
  // ── Chantage à la note ─────────────────────────────────────────────────
  ["Remboursez-moi sinon je mets 1 etoile", "reject"],
  // ── Texte vide de sens ─────────────────────────────────────────────────
  ["aaaaaaaaaa", "reject"],
  ["qsdfghjklm", "reject"],
  // ── Signal faible : publié mais signalé ────────────────────────────────
  ["SERVICE VRAIMENT TRES MAUVAIS ET INACCEPTABLE", "review"],
];

let pass = 0,
  fail = 0;
for (const [txt, want] of CASES) {
  const got = moderateReview(txt).action;
  const ok = got === want;
  console.log(
    `${ok ? "✅" : "❌"} ${want.padEnd(6)} « ${txt.slice(0, 40)} » → ${got}`
  );
  ok ? pass++ : fail++;
}
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
