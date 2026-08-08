import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_RECRUTE_DESIGN,
  DEFAULT_RECRUTE_ROLES,
  RECRUTE_DESIGNS,
  type RecruteDesignKey,
  type RecruteRole,
} from "@/lib/config/recrute-content";

// =============================================================================
// Contenu de la page publique /recrute (tables recrute_page + recrute_roles,
// mig 0450), MIS EN CACHE serveur (tag "recrute-content"). Les actions
// d'administration font revalidateTag → la page se met à jour tout de suite.
//
// Client admin (env pur, sans cookies) : `unstable_cache` interdit tout accès
// au contexte de requête. Les deux tables sont de toute façon en lecture
// publique, donc rien n'est exposé de plus que ce que la page affiche.
//
// Règle de fusion : une colonne NULLE veut dire « garder le défaut du code ».
// Le contenu livré avec le dépôt reste donc la référence, et la base ne porte
// que les CHANGEMENTS — la page reste complète et juste même base vide,
// injoignable, ou migration non appliquée.
// =============================================================================

export type RecruteContent = {
  design: RecruteDesignKey;
  /** `null` = titre livré avec le code (rendu par la page). */
  heroTitle: string | null;
  heroSubtitle: string | null;
  roles: RecruteRole[];
};

const FALLBACK: RecruteContent = {
  design: DEFAULT_RECRUTE_DESIGN,
  heroTitle: null,
  heroSubtitle: null,
  roles: DEFAULT_RECRUTE_ROLES,
};

type PageRow = {
  design: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
};

type RoleRow = {
  key: string;
  img_url: string | null;
  img_alt: string | null;
  title: string | null;
  tagline: string | null;
  highlight: string | null;
  perks: string[] | null;
  cta: string | null;
  position: number | null;
};

/** Chaîne non vide, sinon le défaut (une saisie effacée ne vide pas l'écran). */
const pick = (value: string | null | undefined, fallback: string): string => {
  const v = value?.trim();
  return v ? v : fallback;
};

export const getRecruteContent = unstable_cache(
  async (): Promise<RecruteContent> => {
    try {
      const admin = createAdminClient();
      const from = admin.from.bind(admin) as unknown as (t: string) => {
        select: (c: string) => Promise<{ data: unknown; error: unknown }>;
      };

      const [pageRes, rolesRes] = await Promise.all([
        from("recrute_page").select("design, hero_title, hero_subtitle"),
        from("recrute_roles").select(
          "key, img_url, img_alt, title, tagline, highlight, perks, cta, position"
        ),
      ]);

      const page = ((pageRes.data as PageRow[] | null) ?? [])[0] ?? null;
      const rows = (rolesRes.data as RoleRow[] | null) ?? [];
      const byKey = new Map(rows.map((r) => [r.key, r]));

      const design =
        page?.design && page.design in RECRUTE_DESIGNS
          ? (page.design as RecruteDesignKey)
          : DEFAULT_RECRUTE_DESIGN;

      const roles = DEFAULT_RECRUTE_ROLES.map((base) => {
        const row = byKey.get(base.key);
        if (!row) return base;
        const perks =
          Array.isArray(row.perks) && row.perks.filter(Boolean).length
            ? row.perks.filter(Boolean)
            : base.perks;
        return {
          ...base,
          img: pick(row.img_url, base.img),
          imgAlt: pick(row.img_alt, base.imgAlt),
          title: pick(row.title, base.title),
          tagline: pick(row.tagline, base.tagline),
          highlight: pick(row.highlight, base.highlight),
          cta: pick(row.cta, base.cta),
          perks,
        } satisfies RecruteRole;
      }).sort((a, b) => {
        const pa = byKey.get(a.key)?.position ?? 0;
        const pb = byKey.get(b.key)?.position ?? 0;
        return pa - pb;
      });

      return {
        design,
        heroTitle: page?.hero_title?.trim() || null,
        heroSubtitle: page?.hero_subtitle?.trim() || null,
        roles,
      };
    } catch {
      // Une page de recrutement à moitié vide serait pire qu'un contenu figé :
      // on retombe sur ce qui est livré avec le code.
      return FALLBACK;
    }
  },
  ["recrute-content"],
  { revalidate: 300, tags: ["recrute-content"] }
);

/** Ligne brute par métier — pour l'écran d'administration (champs vides visibles). */
export type RecruteRoleDraft = {
  key: string;
  imgUrl: string;
  imgAlt: string;
  title: string;
  tagline: string;
  highlight: string;
  perks: string[];
  cta: string;
};

/**
 * Lecture NON cachée pour l'administration : elle doit voir ce qui est
 * RÉELLEMENT stocké (champ vide = « défaut du code »), pas le résultat fusionné.
 */
export async function getRecruteDrafts(): Promise<{
  design: RecruteDesignKey;
  heroTitle: string;
  heroSubtitle: string;
  roles: RecruteRoleDraft[];
}> {
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => Promise<{ data: unknown }>;
  };

  const [pageRes, rolesRes] = await Promise.all([
    from("recrute_page").select("design, hero_title, hero_subtitle"),
    from("recrute_roles").select(
      "key, img_url, img_alt, title, tagline, highlight, perks, cta, position"
    ),
  ]);

  const page = ((pageRes.data as PageRow[] | null) ?? [])[0] ?? null;
  const rows = (rolesRes.data as RoleRow[] | null) ?? [];
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return {
    design:
      page?.design && page.design in RECRUTE_DESIGNS
        ? (page.design as RecruteDesignKey)
        : DEFAULT_RECRUTE_DESIGN,
    heroTitle: page?.hero_title ?? "",
    heroSubtitle: page?.hero_subtitle ?? "",
    roles: DEFAULT_RECRUTE_ROLES.map((base) => {
      const r = byKey.get(base.key);
      return {
        key: base.key,
        imgUrl: r?.img_url ?? "",
        imgAlt: r?.img_alt ?? "",
        title: r?.title ?? "",
        tagline: r?.tagline ?? "",
        highlight: r?.highlight ?? "",
        perks: Array.isArray(r?.perks) ? r.perks : [],
        cta: r?.cta ?? "",
      };
    }),
  };
}
