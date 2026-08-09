// Mesure objective de la charge visuelle de l'accueil : hauteur de chrome
// coloré, position du 1er commerce, nombre de strates, éléments par carte.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const TAG = process.argv[2] ?? "état";
const LOC = {
  latitude: 36.7538,
  longitude: 3.0588,
  wilaya_code: "16",
  commune: "Alger Centre",
  address: "Alger Centre",
};

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  locale: "fr-DZ",
});
await ctx.addCookies([
  { name: "NEXT_LOCALE", value: "fr", url: BASE },
  {
    name: "coligo_loc",
    value: encodeURIComponent(
      JSON.stringify({
        la: LOC.latitude,
        lo: LOC.longitude,
        w: LOC.wilaya_code,
        c: LOC.commune,
      })
    ),
    url: BASE,
  },
]);
await ctx.addInitScript(
  ([loc]) => {
    try {
      localStorage.setItem("coligo:customer:location", JSON.stringify(loc));
    } catch {}
  },
  [LOC]
);
const p = await ctx.newPage();
await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(9000);

const res = await p.evaluate(() => {
  const vh = window.innerHeight;
  // Bas du chrome de marque = haut de la zone neutre, c.-à-d. la ligne de
  // recherche (dans les deux versions, c'est le 1er élément sur fond de page).
  let chromeBottom = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.top > 400 || r.width < 320 || r.height < 8) continue;
    const s = getComputedStyle(el);
    // Chrome de MARQUE : aplat ou dégradé partant du violet Coligo (#6C2BD9).
    // (Les bannières promo, aussi en dégradé, sont du CONTENU → exclues.)
    const painted =
      s.backgroundColor === "rgb(108, 43, 217)" ||
      (s.backgroundImage.includes("gradient") &&
        s.backgroundImage.includes("108, 43, 217"));
    if (painted) chromeBottom = Math.max(chromeBottom, Math.round(r.bottom));
  }
  // 1re carte commerce = 1er lien /m/…
  const card = document.querySelector('a[href^="/m/"]');
  const cardBox = card?.getBoundingClientRect();
  const name = card?.querySelector("h3");
  const nameBox = name?.getBoundingClientRect();
  // Brins d'INFORMATION de la 1re carte : chaque fragment de texte affiché
  // (nom, note, statut, mode, distance, ville, minimum…) + les icônes SVG
  // porteuses de sens.
  let texts = 0;
  if (card) {
    const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) if ((w.currentNode.nodeValue ?? "").trim()) texts++;
  }
  const icons = card ? card.querySelectorAll("svg").length : 0;
  const infoBits = texts + icons;
  // Cartes dont le NOM est visible sans défiler.
  const visibleNamed = [...document.querySelectorAll('a[href^="/m/"]')].filter(
    (a) => {
      const h = a.querySelector("h3");
      return h && h.getBoundingClientRect().bottom <= vh;
    }
  ).length;
  return {
    nodes: document.querySelectorAll("*").length,
    viewport: vh,
    chromeBottom: Math.round(chromeBottom),
    firstCardTop: cardBox ? Math.round(cardBox.top) : null,
    firstNameBottom: nameBox ? Math.round(nameBox.bottom) : null,
    infoBits,
    visibleNamed,
  };
});

console.log(
  `${TAG} → chrome coloré : ${res.chromeBottom}px (${Math.round(
    (res.chromeBottom / res.viewport) * 100
  )}% du viewport) · 1re carte à ${res.firstCardTop}px · nom lisible à ${
    res.firstNameBottom
  }px · commerces nommés visibles sans défiler : ${res.visibleNamed} · brins d'info dans la 1re carte : ${res.infoBits} · nœuds DOM : ${res.nodes}`
);
await ctx.close();
await b.close();
