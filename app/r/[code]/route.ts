import { NextResponse } from "next/server";
import { REFERRAL_COOKIE } from "@/lib/referral/attach";

/**
 * Lien de parrainage court `/r/CODE` (partagé via WhatsApp).
 *
 * Route handler (et pas une page) : on doit POSER UN COOKIE (30 j) pour que
 * l'attribution survive même si la personne installe l'app / s'inscrit plus
 * tard sans repasser par le lien. Redirige vers l'inscription préremplie.
 * Code invalide → accueil, sans erreur (le lien a pu être tronqué).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const clean = (code ?? "")
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, "")
    .slice(0, 8);
  const valid = clean.length === 8;

  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(
    new URL(valid ? `/inscription?ref=${clean}` : "/", origin)
  );
  if (valid) {
    res.cookies.set(REFERRAL_COOKIE, clean, {
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });
  }
  return res;
}
