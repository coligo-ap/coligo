import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { adminCan } from "@/lib/auth/admin";
import { buildColigoFlyerPdf } from "@/lib/marketing/flyer-pdf";
import {
  storeLogoPaths,
  cardTitleFontPath,
} from "@/lib/loyalty/card-templates";

export const dynamic = "force-dynamic";

// FLYER PUBLICITAIRE Coligo — recto/verso aux DIMENSIONS DEMANDÉES (cm),
// généré à la volée (jamais stocké, patron des cartes fidélité). Les assets
// (captures réelles de l'app, accroches darija, logos stores, police) vivent
// dans public/brand/ et voyagent via outputFileTracingIncludes.
// Garde : domaine Marketing (session admin).

async function readPublicAsset(rel: string): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(
      path.join(process.cwd(), "public", rel.replace(/^\//, ""))
    );
  } catch {
    return null; // jamais bloquant
  }
}

export async function GET(req: Request) {
  if (!(await adminCan("marketing"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  const url = new URL(req.url);
  const w = Number(url.searchParams.get("w") ?? "14.8");
  const h = Number(url.searchParams.get("h") ?? "21");
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    return NextResponse.json(
      { error: "Dimensions invalides" },
      { status: 400 }
    );
  }

  const [
    logoWhitePng,
    screenMarketplacePng,
    screenStorePng,
    storeApplePng,
    storePlayPng,
    titleFontBytes,
    hookKolchPng,
    hookChriPng,
    hookWinPng,
  ] = await Promise.all([
    readPublicAsset("/brand/logo-full-white.png"),
    readPublicAsset("/brand/flyer/screen-marketplace.png"),
    readPublicAsset("/brand/flyer/screen-store.png"),
    readPublicAsset(storeLogoPaths().apple),
    readPublicAsset(storeLogoPaths().play),
    readPublicAsset(cardTitleFontPath()),
    readPublicAsset("/brand/flyer/darija-hook-kolch.png"),
    readPublicAsset("/brand/flyer/darija-hook-chri.png"),
    readPublicAsset("/brand/flyer/darija-hook-win.png"),
  ]);

  // Origine STABLE (le flyer s'imprime et vit longtemps).
  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://coligo.app"
  ).replace(/\/+$/, "");

  const bytes = await buildColigoFlyerPdf({
    widthCm: w,
    heightCm: h,
    baseUrl,
    assets: {
      logoWhitePng,
      screenMarketplacePng,
      screenStorePng,
      storeApplePng,
      storePlayPng,
      titleFontBytes,
      hookKolchPng,
      hookChriPng,
      hookWinPng,
    },
  });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="flyer-coligo-${String(w).replace(".", "_")}x${String(h).replace(".", "_")}cm.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
