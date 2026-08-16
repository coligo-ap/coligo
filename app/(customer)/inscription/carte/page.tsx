import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getEffectiveFlags } from "@/lib/data/feature-flags";
import { OnboardingCardStep } from "@/components/customer/loyalty/onboarding-card-step";

export const dynamic = "force-dynamic";

// Étape fidélité POST-inscription (SPEC-FIDELITE 3.1) : « Tu as une carte
// fidélité d'un magasin ? » — scanner / saisir le numéro / PASSER (aussi
// visible que Scanner, jamais bloquant). Le compte existe déjà : la liaison
// passe par la RPC authentifiée, la célébration montre le solde récupéré.
export default async function SignupLoyaltyCardPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; code?: string }>;
}) {
  const sp = await searchParams;
  const rawNext = sp.next ?? "/";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const user = await getAuthUser();
  if (!user) redirect("/inscription");

  const flags = await getEffectiveFlags();
  if (flags.loyalty.status !== "active") redirect(next);

  return <OnboardingCardStep next={next} prefillCode={sp.code ?? null} />;
}
