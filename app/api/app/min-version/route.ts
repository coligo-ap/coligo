/**
 * Version minimale imposée de l'app Android CLIENT (Google Play).
 *
 * Lue par `AppUpdateManager` (WebView Capacitor, potentiellement AVANT login)
 * pour décider entre mise à jour Play FLEXIBLE (défaut) et IMMEDIATE (forcée
 * quand versionCode installé < minimum). Valeur PUBLIQUE par conception : un
 * simple entier de politique de mise à jour, aucune donnée utilisateur — d'où
 * le client service_role sans self-guard admin (cf. mig 0335).
 */
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  let minVersionCode = 0;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("platform_settings")
      .select("client_app_min_version_code" as never)
      .eq("id", true as never)
      .maybeSingle();
    minVersionCode = Number(
      (data as { client_app_min_version_code?: number } | null)
        ?.client_app_min_version_code ?? 0
    );
  } catch {
    // En cas de pépin DB on ne force JAMAIS de mise à jour (fail-open).
    minVersionCode = 0;
  }
  return Response.json(
    { minVersionCode },
    // Cache CDN court : la politique de version n'a pas besoin du temps réel,
    // et ça absorbe le trafic de chaque démarrage d'app.
    { headers: { "Cache-Control": "public, s-maxage=300, max-age=300" } }
  );
}
