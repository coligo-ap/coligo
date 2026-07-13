import { getIdvCompliance } from "@/lib/idv/compliance";
import type { IdvProfile } from "@/lib/idv/types";
import { IdvVerifyCard } from "./idv-verify-card";
import { idvStateOf } from "@/lib/idv/ui-state";

// =============================================================================
// IDV — appel à vérification, posé dans les écrans « compte » des trois espaces
// et sur l'écran d'attente d'inscription. Server Component : il lit l'état une
// fois, puis délègue l'affichage au SYSTÈME PARTAGÉ (IdvVerifyCard) — le même
// bloc et le même bouton que l'étape d'inscription. Aucune deuxième façon de
// présenter la vérification.
// Le jumeau client est components/idv/idv-callout-client.tsx.
// =============================================================================

export async function IdvCallout({ profile }: { profile: IdvProfile }) {
  const c = await getIdvCompliance(profile);
  return <IdvVerifyCard idv={idvStateOf(c)} />;
}
