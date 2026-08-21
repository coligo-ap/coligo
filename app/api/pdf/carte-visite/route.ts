import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { adminCan } from "@/lib/auth/admin";
import { buildBusinessCardPdf } from "@/lib/marketing/business-card-pdf";
import { cardTitleFontPath } from "@/lib/loyalty/card-templates";

export const dynamic = "force-dynamic";

// CARTE DE VISITE Coligo (CR80, recto/verso, fonds perdus + traits de coupe) —
// générée à la volée, jamais stockée. Garde : domaine Marketing.

const CONTACT_PHONE = "0564 70 36 31";
const CONTACT_EMAIL = "contact@coligo.app";

async function readPublicAsset(rel: string): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(
      path.join(process.cwd(), "public", rel.replace(/^\//, ""))
    );
  } catch {
    return null;
  }
}

export async function GET() {
  if (!(await adminCan("marketing"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const [backgroundPng, logoPng, titleFontBytes] = await Promise.all([
    readPublicAsset("/brand/loyalty-card-bg-violet.png"),
    readPublicAsset("/brand/logo-full-white.png"),
    readPublicAsset(cardTitleFontPath()),
  ]);

  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://coligo.app"
  ).replace(/\/+$/, "");

  const bytes = await buildBusinessCardPdf({
    phone: CONTACT_PHONE,
    email: CONTACT_EMAIL,
    baseUrl,
    assets: { backgroundPng, logoPng, titleFontBytes },
  });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="carte-visite-coligo.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
