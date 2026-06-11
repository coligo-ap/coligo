import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Avatars chauffeur (photo de visage = selfie du dossier documents).
 * Le bucket driver-docs est PRIVÉ → on signe les chemins (1 h, assez pour
 * une recherche/course). Les URLs http déjà absolues (comptes démo) passent
 * telles quelles. Usage SERVEUR uniquement (service role).
 */
const DOCS_BUCKET = "driver-docs";
const SIGN_TTL = 3600;

const isHttp = (v: string) => /^https?:\/\//.test(v);

/** Signe un chemin selfie déjà connu (évite une requête chauffeurs). */
export async function signSelfiePath(
  path: string | null | undefined
): Promise<string | null> {
  if (!path) return null;
  if (isHttp(path)) return path;
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(DOCS_BUCKET)
    .createSignedUrl(path, SIGN_TTL);
  return data?.signedUrl ?? null;
}

/** Map chauffeur_id → URL d'avatar, en lot (offres, favoris…). */
export async function chauffeurAvatarUrls(
  ids: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (uniq.length === 0) return map;
  const admin = createAdminClient();
  const { data } = await admin
    .from("chauffeurs")
    .select("id, selfie_url")
    .in("id", uniq)
    .not("selfie_url", "is", null);
  const rows = (data ?? []).filter((r) => r.selfie_url) as {
    id: string;
    selfie_url: string;
  }[];
  const toSign = rows.filter((r) => !isHttp(r.selfie_url));
  for (const r of rows) if (isHttp(r.selfie_url)) map.set(r.id, r.selfie_url);
  if (toSign.length > 0) {
    const { data: signed } = await admin.storage
      .from(DOCS_BUCKET)
      .createSignedUrls(
        toSign.map((r) => r.selfie_url),
        SIGN_TTL
      );
    toSign.forEach((r, i) => {
      const u = signed?.[i]?.signedUrl;
      if (u) map.set(r.id, u);
    });
  }
  return map;
}
