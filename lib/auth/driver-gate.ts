/**
 * GATE D'INSCRIPTION LIVREUR — source de vérité serveur.
 *
 * Tant que l'équipe Coligo n'a pas vérifié un livreur, AUCUNE fonctionnalité
 * opérationnelle ne lui est accessible : se mettre en ligne, recevoir des
 * courses, rejoindre un commerçant, ouvrir les tournées, le portefeuille ou
 * les gains. Ce module résout l'étape du parcours à partir de la base, et
 * chaque page/action protégée s'y adosse.
 *
 * Le contournement par l'interface (retour arrière, rechargement, URL tapée à
 * la main, appel direct d'une server action) est sans effet : la base applique
 * les mêmes règles (mig 0352 — `driver_is_active`, gardes RPC, trigger
 * `merchant_drivers`), et les pages/actions revalident ici à chaque requête.
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withTimeoutOrNull } from "@/lib/async/with-timeout";
import { getAuthUser } from "@/lib/auth/session";

/** Étapes du parcours, dans l'ordre. */
export type DriverStage =
  /** Compte créé (ou dossier refusé) → doit remplir/renvoyer son dossier KYC. */
  | "kyc"
  /** Dossier transmis → l'équipe Coligo vérifie. Écran de suivi uniquement. */
  | "pending"
  /** Vérifié, mais le livreur n'a pas encore vu l'écran de félicitations. */
  | "welcome"
  /** Compte pleinement actif : toutes les fonctionnalités sont ouvertes. */
  | "active";

export type DriverGate = {
  id: string;
  userId: string;
  fullName: string;
  firstName: string;
  phone: string;
  avatarUrl: string | null;
  stage: DriverStage;
  isVerified: boolean;
  isFrozen: boolean;
  isBlocked: boolean;
  freezeReason: string | null;
  blockReason: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  /** Félicitations vues mais mode d'activité pas encore choisi. */
  needsModeChoice: boolean;
};

/** Routes du parcours d'inscription (jamais gardées par `requireActiveDriver`). */
export const DRIVER_KYC_ROUTE = "/driver/inscription";
export const DRIVER_PENDING_ROUTE = "/driver/inscription/attente";
export const DRIVER_WELCOME_ROUTE = "/driver/bienvenue";

/** Message unique renvoyé dès qu'un compte non activé tente une action métier. */
export const NOT_ACTIVE_ERROR =
  "Votre compte doit d'abord être vérifié par l'équipe Coligo.";

/**
 * Résout l'étape du livreur connecté. Mémoïsé par requête (React `cache`) :
 * le layout et la page appellent tous deux le gate dans un même rendu.
 * La session est revalidée côté serveur à chaque requête — le cache ne
 * survit pas d'une requête à l'autre.
 */
export const getDriverGate = cache(
  async function getDriverGate(): Promise<DriverGate | null> {
    const supabase = await createClient();
    // PERF+BORNE : `getAuthUser()` est `cache()` — partagée avec getCurrentDriver
    // et le reste de la chaîne dans le MÊME rendu (un seul aller-retour Auth,
    // pas un par helper). Elle est elle-même bornée (lib/auth/session.ts).
    const user = await getAuthUser();
    if (!user) return null;

    const result = await withTimeoutOrNull(
      (async () =>
        supabase
          .from("drivers")
          .select(
            `id, user_id, full_name, phone, avatar_url, is_verified, is_frozen, is_blocked,
         freeze_reason, block_reason, submitted_at, verified_at, verified_ack_at,
         onboarding_done_at, rejected_at, rejection_reason`
          )
          .eq("user_id", user.id)
          .maybeSingle())(),
      4000
    );
    const data = result?.data ?? null;
    if (!data) return null;

    const isVerified = data.is_verified ?? false;
    const submitted = data.submitted_at != null;
    const acked = data.verified_ack_at != null;
    const onboarded = data.onboarding_done_at != null;

    const stage: DriverStage = !isVerified
      ? submitted
        ? "pending"
        : "kyc"
      : acked && onboarded
        ? "active"
        : "welcome";

    return {
      id: data.id,
      userId: data.user_id ?? user.id,
      fullName: data.full_name,
      firstName: data.full_name.split(" ")[0] ?? data.full_name,
      phone: data.phone,
      avatarUrl: data.avatar_url ?? null,
      stage,
      isVerified,
      isFrozen: data.is_frozen ?? false,
      isBlocked: data.is_blocked ?? false,
      freezeReason: data.freeze_reason ?? null,
      blockReason: data.block_reason ?? null,
      submittedAt: data.submitted_at ?? null,
      verifiedAt: data.verified_at ?? null,
      rejectedAt: data.rejected_at ?? null,
      rejectionReason: data.rejection_reason ?? null,
      needsModeChoice: isVerified && acked && !onboarded,
    };
  }
);

/** Route sur laquelle un livreur doit être renvoyé pour son étape courante. */
export function routeForStage(stage: DriverStage): string {
  switch (stage) {
    case "kyc":
      return DRIVER_KYC_ROUTE;
    case "pending":
      return DRIVER_PENDING_ROUTE;
    case "welcome":
      return DRIVER_WELCOME_ROUTE;
    case "active":
      return "/driver";
  }
}

/**
 * Barrière des pages OPÉRATIONNELLES (accueil, gains, tournées, portefeuille,
 * codes commerçant, courses…). Redirige tant que le compte n'est pas activé.
 * À appeler EN TÊTE de chaque page protégée : c'est elle qui rend impossible
 * l'accès par URL directe.
 */
export async function requireActiveDriver(): Promise<DriverGate> {
  const gate = await getDriverGate();
  if (!gate) redirect("/driver/login");
  if (gate.stage !== "active") redirect(routeForStage(gate.stage));
  // NB : la vérification d'identité (IDV) NE redirige PAS d'ici — le layout de
  // l'espace REND un écran bloquant (redirect() sous loading.tsx = React #310
  // en prod, mesuré). Cf. app/(driver)/layout.tsx + lib/idv/compliance.ts.
  return gate;
}

/**
 * Barrière des pages du PARCOURS lui-même : on exige la session et l'étape
 * attendue, sinon on renvoie le livreur là où il doit être (un livreur déjà
 * vérifié n'a rien à faire sur le formulaire KYC, et inversement).
 */
export async function requireDriverStage(
  expected: DriverStage
): Promise<DriverGate> {
  const gate = await getDriverGate();
  if (!gate) redirect("/driver/login");
  if (gate.stage !== expected) redirect(routeForStage(gate.stage));
  return gate;
}
