// =============================================================================
// Cas de test / exemples du moteur de promotions.
// =============================================================================
// Fonctions pures → on peut les vérifier sans base ni framework de test.
// `assertExamples()` lève une erreur au premier écart ; `runExamples()` renvoie
// le détail. Vérif rapide en local (Node 22+) :
//   node --experimental-strip-types lib/promotions/engine.examples.ts
// (un petit runner est inclus en bas, exécuté seulement en ligne de commande.)
// =============================================================================

import { computeCart, type CartLine, type EnginePromotion } from "./engine";

const OPTS = { minPriceDa: 1, commissionRate: 0.05 };

const future = new Date(Date.now() + 86_400_000).toISOString();

type Case = { name: string; got: number | undefined; expected: number };

function cases(): Case[] {
  const out: Case[] = [];
  const push = (name: string, got: number | undefined, expected: number) =>
    out.push({ name, got, expected });

  // A) Réduction produit -20 %.
  {
    const lines: CartLine[] = [
      { productId: "P1", quantity: 2, unitPriceDa: 100 },
    ];
    const promos: EnginePromotion[] = [
      {
        id: "promoA",
        type: "product_discount",
        status: "active",
        discountKind: "percent",
        discountValue: 20,
        productIds: ["P1"],
      },
    ];
    const r = computeCart(lines, promos, OPTS);
    push("A.appliedUnit", r.lines[0].appliedUnitPriceDa, 80);
    push("A.total", r.totalDa, 160);
    push("A.commission", r.commissionDa, 8);
    push("A.savings", r.savingsDa, 40);
  }

  // B) Réduction en DA supérieure au prix → capée au plancher (1 DA).
  {
    const lines: CartLine[] = [
      { productId: "P1", quantity: 1, unitPriceDa: 50 },
    ];
    const promos: EnginePromotion[] = [
      {
        id: "promoB",
        type: "product_discount",
        status: "active",
        discountKind: "amount",
        discountValue: 60,
        productIds: ["P1"],
      },
    ];
    const r = computeCart(lines, promos, OPTS);
    push("B.appliedUnit(plancher)", r.lines[0].appliedUnitPriceDa, 1);
    push("B.total", r.totalDa, 1);
  }

  // C) Offre quantité 2 achetés = 1 offert, sur 3 unités.
  {
    const lines: CartLine[] = [
      { productId: "P1", quantity: 3, unitPriceDa: 100 },
    ];
    const promos: EnginePromotion[] = [
      {
        id: "promoC",
        type: "quantity_offer",
        status: "active",
        buyQty: 2,
        getQty: 1,
        productIds: ["P1"],
      },
    ];
    const r = computeCart(lines, promos, OPTS);
    push("C.freeUnits", r.lines[0].freeUnits, 1);
    push("C.paidQty", r.lines[0].paidQuantity, 2);
    push("C.total", r.totalDa, 200);
    push("C.savings", r.savingsDa, 100);
  }

  // D) Cumul réduction produit (-10 %) + code promo (-10 % sur le total).
  {
    const lines: CartLine[] = [
      { productId: "P1", quantity: 2, unitPriceDa: 100 },
    ];
    const promos: EnginePromotion[] = [
      {
        id: "promoD1",
        type: "product_discount",
        status: "active",
        discountKind: "percent",
        discountValue: 10,
        productIds: ["P1"],
      },
      {
        id: "promoD2",
        type: "promo_code",
        status: "active",
        discountKind: "percent",
        discountValue: 10,
        code: "WELCOME",
      },
    ];
    const r = computeCart(lines, promos, { ...OPTS, promoCode: "welcome" });
    push("D.subtotal", r.subtotalDa, 180);
    push("D.codeDiscount", r.promoCode?.discountDa, 18);
    push("D.total", r.totalDa, 162);
    push("D.commission", r.commissionDa, 8);
  }

  // E) Deux réductions produit → on prend la plus avantageuse (la moins chère).
  {
    const lines: CartLine[] = [
      { productId: "P1", quantity: 1, unitPriceDa: 100 },
    ];
    const promos: EnginePromotion[] = [
      {
        id: "promoE1",
        type: "product_discount",
        status: "active",
        discountKind: "percent",
        discountValue: 10,
        productIds: ["P1"],
      },
      {
        id: "promoE2",
        type: "product_discount",
        status: "active",
        discountKind: "amount",
        discountValue: 30,
        productIds: ["P1"],
      },
    ];
    const r = computeCart(lines, promos, OPTS);
    push("E.appliedUnit(meilleure)", r.lines[0].appliedUnitPriceDa, 70);
  }

  // F) Promo programmée (début dans le futur) → inactive, aucun effet.
  {
    const lines: CartLine[] = [
      { productId: "P1", quantity: 1, unitPriceDa: 100 },
    ];
    const promos: EnginePromotion[] = [
      {
        id: "promoF",
        type: "product_discount",
        status: "active",
        discountKind: "percent",
        discountValue: 50,
        productIds: ["P1"],
        startsAt: future,
      },
    ];
    const r = computeCart(lines, promos, OPTS);
    push("F.appliedUnit(inchangé)", r.lines[0].appliedUnitPriceDa, 100);
  }

  // G) Code en DA supérieur au sous-total → capé, total au plancher (jamais 0).
  {
    const lines: CartLine[] = [
      { productId: "P1", quantity: 1, unitPriceDa: 100 },
    ];
    const promos: EnginePromotion[] = [
      {
        id: "promoG",
        type: "promo_code",
        status: "active",
        discountKind: "amount",
        discountValue: 150,
        code: "GROS",
      },
    ];
    const r = computeCart(lines, promos, { ...OPTS, promoCode: "GROS" });
    push("G.codeDiscount(capé)", r.promoCode?.discountDa, 100);
    push("G.total(plancher)", r.totalDa, 1);
  }

  return out;
}

export function runExamples(): {
  name: string;
  ok: boolean;
  got: unknown;
  expected: unknown;
}[] {
  return cases().map((c) => ({
    name: c.name,
    ok: c.got === c.expected,
    got: c.got,
    expected: c.expected,
  }));
}

export function assertExamples(): void {
  for (const r of runExamples()) {
    if (!r.ok) {
      throw new Error(
        `Cas « ${r.name} » : attendu ${r.expected}, obtenu ${r.got}`
      );
    }
  }
}

// Runner CLI : exécuté uniquement quand on lance le fichier directement.
// (Inerte lors d'un import par l'application — pas d'effet de bord.)
if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.includes("engine.examples")
) {
  const results = runExamples();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}  (=${r.got})`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} cas en échec.`);
    process.exit(1);
  } else {
    console.log(`\nTous les cas passent (${results.length}).`);
  }
}
