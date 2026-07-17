import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FraudActorView } from "@/components/admin/fraud/fraud-actor-view";
import {
  FRAUD_KINDS,
  type FraudActorDetail,
  type FraudActorKind,
} from "@/lib/fraud/model";

export const dynamic = "force-dynamic";

/**
 * Centre Anti-Fraude — INVESTIGATION d'un compte : scores expliqués, évolution,
 * timeline, appareils/IP, comptes liés, mesures (application / révocation).
 */
export default async function AdminFraudActorPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (!FRAUD_KINDS.includes(kind as FraudActorKind)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_fraud_actor" as never,
    { p_kind: kind, p_id: id } as never
  );
  if (error) console.error("admin_fraud_actor:", error.message);
  return (
    <FraudActorView
      kind={kind as FraudActorKind}
      actorId={id}
      detail={(data ?? null) as unknown as FraudActorDetail | null}
    />
  );
}
