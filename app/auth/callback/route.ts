import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidContactPhone } from "@/lib/dz/phone";

/**
 * Callback OAuth (Google, etc.) — échange le code contre une session, puis
 * provisionne le profil `customers` au 1er login social. Le téléphone n'étant
 * pas fourni par le provider, on envoie l'utilisateur compléter son numéro sur
 * /compte avant de pouvoir commander.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/se-connecter?error=oauth", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/se-connecter?error=oauth", origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/se-connecter?error=oauth", origin));
  }

  // Commerçant connecté via social → espace commerçant, pas de profil client.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) {
    return NextResponse.redirect(new URL("/dashboard", origin));
  }

  // Provisionne le profil client au 1er login social.
  const { data: customer } = await supabase
    .from("customers")
    .select("id, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  let phone = customer?.phone ?? null;
  if (!customer) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = String(
      meta.full_name || meta.name || user.email?.split("@")[0] || "Client"
    ).slice(0, 80);
    await supabase.from("customers").insert({
      user_id: user.id,
      full_name: fullName,
      email: user.email ?? null,
      phone: null,
    });
    phone = null;
  }

  // Sans numéro valide (obligatoire) → page de saisie BLOQUANTE. Le middleware
  // applique la même règle sur toutes les pages (filet de sécurité).
  if (!isValidContactPhone(phone)) {
    const url = new URL("/compte/telephone", origin);
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(next, origin));
}
