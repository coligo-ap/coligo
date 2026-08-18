import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildLoyaltyCardsPdf } from "@/lib/loyalty/card-pdf";
import {
  cardArWafaAssetPath,
  cardBgAssetPath,
  cardLogoAssetPath,
  cardTitleFontPath,
  getCardTemplate,
  storeLogoPaths,
} from "@/lib/loyalty/card-templates";

export const dynamic = "force-dynamic";

// PDF d'impression d'un LOT de cartes fidélité — généré à la VOLÉE depuis la
// base (jamais stocké, patron des contrats) : le super-admin peut le
// retélécharger à tout moment, le fichier reflète toujours le lot réel (y
// compris pour un lot supprimé/bloqué : archive imprimable).
// Garde : domaine Commerçants (session admin). Le service_role ne sert QU'À
// lire le bucket privé `loyalty-card-art` (visuels personnalisés, mig 0461),
// APRÈS la garde admin.
// Les assets de public/brand/ voyagent avec la fonction serverless via
// outputFileTracingIncludes (next.config.ts) — même patron que les modèles IDV.

async function readPublicAsset(rel: string): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(
      path.join(process.cwd(), "public", rel.replace(/^\//, ""))
    );
  } catch {
    return null; // jamais bloquant : la carte sort en repli vectoriel
  }
}

/** Logo du commerçant (option 0462) : téléchargé BORNÉ puis re-encodé PNG via
 *  sharp — pdf-lib n'embarque ni WebP ni AVIF, et le re-encodage neutralise
 *  tout contenu piégé (jamais l'octet d'origine dans le PDF). Échec = carte
 *  sans logo, jamais bloquant. */
async function fetchMerchantLogoPng(
  url: string | null
): Promise<Uint8Array | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 10 * 1024 * 1024) return null;
    const sharp = (await import("sharp")).default;
    return new Uint8Array(
      await sharp(buf)
        .resize(600, 600, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer()
    );
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ batchId: string }> }
) {
  if (!(await adminCan("commercants"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  const { batchId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) {
    return NextResponse.json({ error: "Lot introuvable" }, { status: 404 });
  }

  const supabase = await createClient();
  // Tables hors types générés → cast local du `from` (convention du repo).
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{ data: { card_code: string }[] | null }>;
      };
    };
  };

  const { data: batch } = await from("loyalty_card_batches")
    .select(
      "id, merchant_id, template_key, quantity, print_merchant_name, print_title, print_merchant_logo, print_valid_all, art_recto_path, art_verso_path, merchants(name, logo_url, category)"
    )
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) {
    return NextResponse.json({ error: "Lot introuvable" }, { status: 404 });
  }

  const { data: cards } = await from("loyalty_cards")
    .select("card_code")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (!cards || cards.length === 0) {
    return NextResponse.json(
      { error: "Aucune carte dans ce lot" },
      { status: 404 }
    );
  }

  // Visuels PERSONNALISÉS du lot (bucket PRIVÉ — service_role après la garde).
  let artRecto: Uint8Array | null = null;
  let artVerso: Uint8Array | null = null;
  const rectoPath = (batch.art_recto_path as string | null) ?? null;
  const versoPath = (batch.art_verso_path as string | null) ?? null;
  if (rectoPath || versoPath) {
    const admin = createAdminClient();
    const download = async (p: string | null): Promise<Uint8Array | null> => {
      if (!p) return null;
      const { data } = await admin.storage.from("loyalty-card-art").download(p);
      if (!data) return null;
      return new Uint8Array(await data.arrayBuffer());
    };
    [artRecto, artVerso] = await Promise.all([
      download(rectoPath),
      download(versoPath),
    ]);
  }

  // Lot GÉNÉRIQUE (merchant_id NULL) ou nom volontairement non imprimé.
  const merchant =
    (batch.merchants as {
      name?: string;
      logo_url?: string | null;
      category?: string | null;
    } | null) ?? null;
  const merchantName = merchant?.name ?? null;
  const printMerchantName = batch.print_merchant_name !== false;
  const templateKey = String(batch.template_key ?? "violet");
  const tpl = getCardTemplate(templateKey);

  // Décor PRODUITS par catégorie de commerce (public/brand/loyalty-decor/) :
  // supérette = grandes marques algériennes détourées (RAMY, CANDIA, ROUIBA…),
  // food = médaillons ronds. Catégorie inconnue / lot générique = pas de décor.
  const DECOR_BY_CATEGORY: Record<string, string[]> = {
    superette: ["superette-1", "superette-4", "superette-5"],
    alimentation: ["superette-1", "superette-4", "superette-5"],
    epicerie: ["superette-1", "superette-4", "superette-5"],
    fast_food: ["fastfood-2", "fastfood-1", "fastfood-3"],
    pizzeria: ["fastfood-2", "fastfood-3", "fastfood-1"],
    restaurant: ["restaurant-1", "restaurant-2"],
    boulangerie: ["boulangerie-1", "boulangerie-3", "boulangerie-2"],
    patisserie: ["boulangerie-2", "boulangerie-1", "boulangerie-3"],
  };
  const decorNames = DECOR_BY_CATEGORY[merchant?.category ?? ""] ?? [];

  const [
    backgroundPng,
    logoPng,
    arWafaPng,
    titleFontBytes,
    storeApplePng,
    storePlayPng,
    merchantLogoPng,
    darijaLinesPngs,
    decorPngs,
  ] = await Promise.all([
    readPublicAsset(cardBgAssetPath(templateKey)),
    readPublicAsset(cardLogoAssetPath(tpl)),
    readPublicAsset(cardArWafaAssetPath(tpl)),
    readPublicAsset(cardTitleFontPath()),
    readPublicAsset(storeLogoPaths().apple),
    readPublicAsset(storeLogoPaths().play),
    batch.print_merchant_logo === true
      ? fetchMerchantLogoPng(merchant?.logo_url ?? null)
      : Promise.resolve(null),
    Promise.all(
      ["promos", "chaine", "livraison", "dahabia"].map((k) =>
        readPublicAsset(`/brand/flyer/darija-line-${k}.png`)
      )
    ),
    Promise.all(
      decorNames.map((n) => readPublicAsset(`/brand/loyalty-decor/${n}.png`))
    ),
  ]);

  // Origine STABLE : une carte imprimée vit des années — jamais une URL de
  // déploiement (cf. app/sitemap.ts).
  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://coligo.app"
  ).replace(/\/+$/, "");

  const bytes = await buildLoyaltyCardsPdf({
    merchantName,
    printMerchantName,
    printTitle: batch.print_title !== false,
    printValidAll: batch.print_valid_all === true,
    merchantLogoPng,
    templateKey,
    cards: cards.map((c) => ({ code: c.card_code })),
    baseUrl,
    assets: {
      backgroundPng,
      logoPng,
      arWafaPng,
      titleFontBytes,
      storeApplePng,
      storePlayPng,
      darijaLinesPngs,
      decorPngs,
    },
    artRecto,
    artVerso,
  });

  const slug = (merchantName ?? "generique")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // TÉLÉCHARGEMENT DIRECT (demande propriétaire) : le clic enregistre le
      // fichier — aucun onglet/popup, fiable aussi dans la WebView Capacitor.
      "Content-Disposition": `attachment; filename="cartes-fidelite-${slug || "coligo"}-${batchId.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
