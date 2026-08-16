import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { buildLoyaltyCardsPdf } from "@/lib/loyalty/card-pdf";

export const dynamic = "force-dynamic";

// PDF d'impression d'un LOT de cartes fidélité (SPEC-FIDELITE 4.0) — généré à
// la VOLÉE depuis la base (jamais stocké, patron des contrats) : le super-admin
// peut le retélécharger à tout moment, le fichier reflète toujours le lot réel.
// Garde : domaine Commerçants (session admin, jamais service_role).

// Logotype arabe كوليغو (fond blanc) embarqué dans la fonction serverless via
// outputFileTracingIncludes (next.config.ts) — même patron que les modèles IDV.
const AR_LOGO_FILE = "logo-coligo-AR-Bg_blanc-Ecr_Violet.png";

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
    .select("id, merchant_id, template_key, quantity, merchants(name)")
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

  let arabicLogoPng: Uint8Array | null = null;
  try {
    arabicLogoPng = await fs.readFile(
      path.join(process.cwd(), "public", AR_LOGO_FILE)
    );
  } catch {
    /* la carte sort sans la pastille arabe — jamais bloquant */
  }

  const merchantName =
    ((batch.merchants as { name?: string } | null)?.name ?? "Commerçant") + "";
  // Origine STABLE : une carte imprimée vit des années — jamais une URL de
  // déploiement (cf. app/sitemap.ts).
  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://coligo.app"
  ).replace(/\/+$/, "");

  const bytes = await buildLoyaltyCardsPdf({
    merchantName,
    templateKey: String(batch.template_key ?? "violet"),
    cards: cards.map((c) => ({ code: c.card_code })),
    baseUrl,
    arabicLogoPng,
  });

  const slug = merchantName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="cartes-fidelite-${slug || "coligo"}-${batchId.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
