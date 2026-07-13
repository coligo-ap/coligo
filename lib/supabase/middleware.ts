import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { withLongSession } from "./session-config";
import { isValidContactPhone } from "@/lib/dz/phone";

/**
 * Borne une promesse réseau : résout `null` si elle dépasse `ms` (au lieu de
 * laisser la requête pendre indéfiniment et bloquer le middleware). Le timer est
 * nettoyé dans tous les cas.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

// Cache par-IP du statut de blocage (mig 0287). Évite un appel RPC par requête :
// 1 appel / IP / 60 s max. Fail-open sur timeout (sécurité best-effort qui ne
// casse jamais la navigation sur lien instable). La déconnexion forcée des
// sessions reste, elle, immédiate côté admin.
const ipBlockCache = new Map<string, { blocked: boolean; at: number }>();
const IP_BLOCK_TTL = 60_000;

async function isIpBlockedCached(
  supabase: ReturnType<typeof createServerClient<Database>>,
  ip: string
): Promise<boolean> {
  if (!ip) return false;
  const hit = ipBlockCache.get(ip);
  if (hit && Date.now() - hit.at < IP_BLOCK_TTL) return hit.blocked;
  // Le builder rpc est un PromiseLike (pas un vrai Promise) → on le wrappe dans
  // une async IIFE pour withTimeout, et on garde l'appel EN MÉTHODE (this lié).
  const res = await withTimeout(
    (async () =>
      supabase.rpc("is_ip_blocked" as never, { p_ip: ip } as never))(),
    1500
  );
  if (res === null) return false; // timeout → fail-open, pas de mise en cache
  const blocked = (res as { data?: unknown }).data === true;
  ipBlockCache.set(ip, { blocked, at: Date.now() });
  return blocked;
}

// Pages de connexion de chaque espace : seuls endroits où l'on vérifie le
// blocage d'IP (cf. updateSession). Bloquer ici = empêcher toute (re)connexion.
const LOGIN_PATHS = new Set<string>([
  "/portail",
  "/login",
  "/se-connecter",
  "/driver/login",
  "/chauffeur/login",
  "/partenaire/login",
]);

/** IP client (même extraction que la télémétrie : x-forwarded-for en tête). */
function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

export async function updateSession(request: NextRequest) {
  // Chemin courant exposé aux Server Components (les layouts ne le reçoivent
  // pas). Utilisé par les gardes qui RENDENT un écran bloquant plutôt que de
  // rediriger (IDV) : le layout doit laisser passer la page du parcours
  // lui-même, sinon l'utilisateur ne pourrait jamais s'y rendre.
  request.headers.set("x-pathname", request.nextUrl.pathname);
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, withLongSession(options))
          );
        },
      },
    }
  );

  // IMPORTANT : ne rien intercaler entre createServerClient et getUser()
  // (sinon la session peut ne pas être rafraîchie → déconnexions aléatoires).
  // En cas d'échec réseau (Algérie : lien instable vers Supabase), on ne casse
  // pas la navigation : on traite comme "non connecté" sans rediriger en boucle.
  //
  // BORNE OBLIGATOIRE : `getUser()` fait un aller-retour Vercel→Supabase Auth.
  // Sur lien DZ instable il peut TRAÎNER sans jamais résoudre — or ce middleware
  // gate CHAQUE navigation (chaque fetch RSC) : un getUser fantôme = navigation
  // bloquée côté serveur (loader infini) pour tout l'onglet. On le borne donc à
  // 4 s (timeout → traité comme « non connecté », comme un échec réseau) plutôt
  // que de laisser la requête pendre. Même esprit que le disjoncteur OSRM.
  let user = null;
  try {
    const result = await withTimeout(supabase.auth.getUser(), 4000);
    user = result?.data.user ?? null;
  } catch {
    user = null;
  }

  const path = request.nextUrl.pathname;
  const isMerchantAuthRoute = path === "/login" || path === "/signup";
  const isCustomerAuthRoute =
    path === "/se-connecter" || path === "/inscription";
  // Un layout (MerchantShell / admin) renvoie parfois vers /login?error=...
  // (pas de boutique, accès refusé, requête échouée). Dans ce cas il NE FAUT
  // PAS renvoyer l'utilisateur connecté vers /dashboard, sinon boucle infinie.
  const bouncedWithError = request.nextUrl.searchParams.has("error");

  // Redirige EN RECOPIANT les cookies de session rafraîchis sur la réponse de
  // redirection. Sans ça, NextResponse.redirect() crée une réponse SANS ces
  // cookies → la session ne se pose jamais → boucle ERR_TOO_MANY_REDIRECTS.
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = ""; // évite de traîner les ?error= d'une redirection à l'autre
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  };

  // ===========================================================================
  // BLOCAGE D'IP (anti-fraude/abus, mig 0287). PERF : on NE vérifie QUE sur les
  // pages de CONNEXION (événement rare) — surtout PAS sur chaque navigation (ce
  // qui ajouterait un appel DB au chemin critique de chaque page). Le blocage
  // reste effectif : combiné à « Déconnecter les sessions » (immédiat), une IP
  // bannie ne peut plus se (re)connecter → page de login réécrite vers /bloque.
  // Le check reste caché par IP (60 s) + fail-open sur timeout.
  // ===========================================================================
  if (LOGIN_PATHS.has(path)) {
    if (await isIpBlockedCached(supabase, clientIp(request))) {
      const url = request.nextUrl.clone();
      url.pathname = "/bloque";
      url.search = "";
      return NextResponse.rewrite(url);
    }
  }

  // ===========================================================================
  // ISOLATION DES RÔLES (anti-fraude) — un livreur reste DANS son espace.
  // ---------------------------------------------------------------------------
  // Un livreur s'authentifie avec un email synthétique `<tel>@drivers.coligo.local`
  // (cf. lib/auth/driver). On le détecte SANS requête DB. Une session livreur ne
  // doit JAMAIS pouvoir naviguer la marketplace client ni l'espace commerçant
  // (chacun son rôle). Pour agir en client/commerçant, il doit se déconnecter
  // puis s'inscrire/se connecter via l'écran dédié. Une seule identité active
  // par session (même navigateur / même fenêtre).
  // ===========================================================================
  const isDriverSession =
    !!user?.email && user.email.endsWith("@drivers.coligo.local");
  if (isDriverSession) {
    const allowed =
      path === "/driver" ||
      path.startsWith("/driver/") ||
      path.startsWith("/api/") ||
      path.startsWith("/auth") ||
      path.startsWith("/offline");
    if (!allowed) {
      return redirectTo("/driver");
    }
    // Session livreur sur une route autorisée (/driver…) → on laisse passer sans
    // exécuter la logique d'atterrissage marchand/client ci-dessous.
    return supabaseResponse;
  }

  // Isolation CHAUFFEUR VTC (population séparée) — confiné à /chauffeur.
  const isChauffeurSession =
    !!user?.email && user.email.endsWith("@chauffeurs.coligo.local");
  if (isChauffeurSession) {
    const allowed =
      path === "/chauffeur" ||
      path.startsWith("/chauffeur/") ||
      path.startsWith("/api/") ||
      path.startsWith("/auth") ||
      path.startsWith("/offline");
    if (!allowed) {
      return redirectTo("/chauffeur");
    }
    return supabaseResponse;
  }

  // Isolation POINT DE RECHARGE partenaire — confiné à /partenaire.
  const isPartnerSession =
    !!user?.email && user.email.endsWith("@partners.coligo.local");
  if (isPartnerSession) {
    const allowed =
      path === "/partenaire" ||
      path.startsWith("/partenaire/") ||
      path.startsWith("/api/") ||
      path.startsWith("/auth") ||
      path.startsWith("/offline");
    if (!allowed) {
      return redirectTo("/partenaire");
    }
    return supabaseResponse;
  }

  // ===========================================================================
  // ISOLATION SUPER-ADMIN — confiné à /admin (comme livreur/chauffeur à leur
  // espace). Un admin a un email « normal » sans row merchants/customers → il
  // n'était cloisonné NULLE PART et pouvait naviguer toute la marketplace
  // client (et atterrir dans l'espace client depuis /dashboard). On le ramène
  // à /admin pour TOUTE page hors /admin et hors routes neutres (/api, /auth,
  // /offline, /portail : login/déconnexion/refus). Pas de boucle : la cible
  // /admin et /portail sont exemptés. Statut résolu une fois puis caché.
  // ===========================================================================
  if (user) {
    const adminExempt =
      path === "/admin" ||
      path.startsWith("/admin/") ||
      path.startsWith("/api") ||
      path.startsWith("/auth") ||
      path.startsWith("/offline") ||
      path === "/portail" ||
      path.startsWith("/portail/");
    if (
      !adminExempt &&
      (await isAdminCached(request, supabaseResponse, supabase, user.id))
    ) {
      return redirectTo("/admin");
    }
  }

  // ===========================================================================
  // RÉCIPROQUE : les espaces /driver et /chauffeur ne sont servis QU'AUX
  // sessions du bon domaine. Une session client/commerçant (ou anonyme) qui
  // tape /driver/... est renvoyée sur l'écran de connexion livreur — seules
  // les pages publiques login/signup restent accessibles (pour changer de
  // compte). Chaque métier a son inscription : pas de double identité.
  // ===========================================================================
  if (path === "/driver" || path.startsWith("/driver/")) {
    const publicDriver = path === "/driver/login" || path === "/driver/signup";
    if (!publicDriver) return redirectTo("/driver/login");
  }
  if (path === "/chauffeur" || path.startsWith("/chauffeur/")) {
    const publicChauffeur =
      path === "/chauffeur/login" || path === "/chauffeur/signup";
    if (!publicChauffeur) return redirectTo("/chauffeur/login");
  }
  if (path === "/partenaire" || path.startsWith("/partenaire/")) {
    const publicPartner =
      path === "/partenaire/login" || path === "/partenaire/signup";
    if (!publicPartner) return redirectTo("/partenaire/login");
  }

  // ===========================================================================
  // NUMÉRO DE TÉLÉPHONE OBLIGATOIRE (client) — anti-fraude + contact livraison.
  // ---------------------------------------------------------------------------
  // Un client connecté (notamment via Google, qui ne fournit pas de numéro)
  // DOIT renseigner un mobile algérien valide. Tant que ce n'est pas fait, on
  // le force sur /compte/telephone, quelle que soit la page demandée. Le cookie
  // `coligo_phone_ok` court-circuite la vérif une fois le numéro validé (évite
  // une requête DB à chaque navigation).
  // ===========================================================================
  if (user) {
    const phoneExempt =
      path.startsWith("/api") ||
      path.startsWith("/auth") ||
      path.startsWith("/dashboard") ||
      path.startsWith("/offline") ||
      path === "/login" ||
      // /signup + /signup/boutique (complétion Google commerçant) : un compte
      // qui a AUSSI un profil client sans numéro ne doit pas être détourné
      // vers /compte/telephone pendant qu'il crée sa boutique.
      path.startsWith("/signup") ||
      path === "/se-connecter" ||
      path === "/inscription" ||
      path.startsWith("/compte/telephone");
    const phoneOk = request.cookies.get("coligo_phone_ok")?.value === "1";
    if (!phoneExempt && !phoneOk) {
      const { data: cust } = await supabase
        .from("customers")
        .select("phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cust) {
        if (isValidContactPhone(cust.phone)) {
          // Numéro déjà valide → on mémorise pour ne plus requêter.
          supabaseResponse.cookies.set("coligo_phone_ok", "1", {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
          });
        } else {
          // Numéro manquant/non conforme → page de saisie OBLIGATOIRE.
          const url = request.nextUrl.clone();
          url.pathname = "/compte/telephone";
          url.search = "";
          if (path && path !== "/") url.searchParams.set("next", path);
          const gate = NextResponse.redirect(url);
          supabaseResponse.cookies.getAll().forEach((c) => gate.cookies.set(c));
          return gate;
        }
      }
    }
  }

  // /dashboard exige une session — sinon login marchand.
  if (path.startsWith("/dashboard") && !user) {
    return redirectTo("/login");
  }

  // Espace pro marchand (/login, /signup) :
  // - connecté + déjà commerçant → /dashboard
  // - connecté + client (a une row customers) → /
  // - le check "merchant ou customer" est délégué à un appel léger côté DB
  //   uniquement si on est sur ces routes (≤ 1 query supplémentaire).
  if (user && isMerchantAuthRoute && !bouncedWithError) {
    const target = await resolveLandingForUser(supabase, user.id);
    return redirectTo(target);
  }

  // Espace client (/se-connecter, /inscription) :
  // - connecté + commerçant → /dashboard (pas de double identité possible)
  // - connecté + client → / (accueil marketplace)
  if (user && isCustomerAuthRoute && !bouncedWithError) {
    const target = await resolveLandingForUser(supabase, user.id);
    return redirectTo(target);
  }

  // ===========================================================================
  // CLOISONNEMENT COMMERÇANT ↔ CLIENT (sessions email « normales »).
  // ---------------------------------------------------------------------------
  // Chaque métier voit UNIQUEMENT son espace :
  //   • une session COMMERÇANT qui tape une page client (/, /cashback,
  //     /checkout, /compte, /drive, /m/..., etc.) est renvoyée sur /dashboard ;
  //     pour agir en client, il doit se connecter avec un compte CLIENT.
  //   • une session CLIENT qui tape une page commerçant (/dashboard, /orders,
  //     /finances, etc.) est renvoyée sur l'accueil marketplace.
  // Le rôle est résolu UNE fois puis mis en cache cookie (coligo_role) — pas
  // de requête DB à chaque navigation. Le rôle ne change jamais (trigger
  // assert_user_role_uniqueness : un user ne peut pas être les deux).
  // ===========================================================================
  if (user) {
    const inMerchantSpace = MERCHANT_ROOTS.some(
      (r) => path === r || path.startsWith(r + "/")
    );
    const neutral =
      path.startsWith("/api") ||
      path.startsWith("/auth") ||
      path.startsWith("/admin") ||
      path === "/portail" ||
      path.startsWith("/portail/") ||
      path.startsWith("/offline") ||
      path === "/t" ||
      path.startsWith("/t/") ||
      isMerchantAuthRoute ||
      isCustomerAuthRoute;
    if (!neutral) {
      const role = await resolveCachedRole(
        request,
        supabaseResponse,
        supabase,
        user.id
      );
      if (role === "merchant" && !inMerchantSpace) {
        return redirectTo("/dashboard");
      }
      if (role !== "merchant" && inMerchantSpace) {
        return redirectTo("/");
      }
    }
  }

  return supabaseResponse;
}

/** Racines de l'espace commerçant (tout le reste hors neutre = espace client). */
const MERCHANT_ROOTS = [
  "/dashboard",
  "/orders",
  "/catalog",
  "/promotions",
  "/finances",
  "/livraison",
  "/livreurs",
  "/encaisser",
  "/stats",
  "/aide",
  "/settings",
  "/telecharger",
  "/recharger", // Coligo Pay commerçant — sinon le commerçant est renvoyé au dashboard
];

/**
 * Rôle d'une session « email normal » : commerçant / client / aucun profil.
 * Mis en cache dans le cookie `coligo_role` (préfixé par l'id user pour ne
 * jamais réutiliser le rôle d'une session précédente). « none » est re-résolu
 * rapidement (le profil peut être créé juste après l'inscription).
 */
async function resolveCachedRole(
  request: NextRequest,
  response: NextResponse,
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string
): Promise<"merchant" | "customer" | "none"> {
  const prefix = userId.slice(0, 8);
  const cached = request.cookies.get("coligo_role")?.value;
  if (cached?.startsWith(prefix + ":")) {
    const r = cached.slice(prefix.length + 1);
    if (r === "m") return "merchant";
    if (r === "c") return "customer";
    // "n" → on re-résout (profil peut-être créé entre-temps).
  }

  let role: "merchant" | "customer" | "none" = "none";
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (merchant) {
    role = "merchant";
  } else {
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (customer) role = "customer";
  }

  response.cookies.set(
    "coligo_role",
    `${prefix}:${role === "merchant" ? "m" : role === "customer" ? "c" : "n"}`,
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Un rôle résolu est immuable → cache long. « none » expire vite.
      maxAge: role === "none" ? 60 : 60 * 60 * 24 * 7,
    }
  );
  return role;
}

/**
 * Session SUPER-ADMIN ? Résolu une fois via la RPC `is_super_admin` (la même que
 * lib/auth/admin) puis mis en cache cookie `coligo_adm` (préfixé user-id, comme
 * coligo_role). Évite une requête à chaque navigation. Le statut admin ne change
 * quasiment jamais → cache long. Tout échec réseau = traité comme NON-admin
 * (fail-closed côté confinement : on ne bloque pas un non-admin par erreur).
 */
async function isAdminCached(
  request: NextRequest,
  response: NextResponse,
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string
): Promise<boolean> {
  const prefix = userId.slice(0, 8);
  const cached = request.cookies.get("coligo_adm")?.value;
  if (cached === `${prefix}:1`) return true;
  if (cached === `${prefix}:0`) return false;

  let isAdmin = false;
  try {
    const { data } = await supabase.rpc("is_super_admin");
    isAdmin = data === true;
  } catch {
    isAdmin = false;
  }

  response.cookies.set("coligo_adm", `${prefix}:${isAdmin ? "1" : "0"}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return isAdmin;
}

/**
 * Décide vers quelle page atterrir un user authentifié, selon qu'il est
 * commerçant ou client. Fait au plus 2 requêtes très légères (id only).
 */
async function resolveLandingForUser(
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string
): Promise<string> {
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (merchant) return "/dashboard";
  return "/";
}
