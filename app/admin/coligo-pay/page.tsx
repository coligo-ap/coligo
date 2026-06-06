import {
  getColigoPayAudit,
  getColigoPayOverview,
  getSecurityEvents,
} from "@/lib/data/coligo-pay-admin";
import { ColigoPaySurveillance } from "@/components/admin/coligo-pay-surveillance";

export const dynamic = "force-dynamic";

// =============================================================================
// /admin/coligo-pay — surveillance, réconciliation et journal d'audit Coligo Pay.
// Gate super-admin assuré par app/admin/layout.tsx (requireSuperAdmin).
// =============================================================================
export default async function AdminColigoPayPage() {
  const [overview, audit, events] = await Promise.all([
    getColigoPayOverview(),
    getColigoPayAudit(80),
    getSecurityEvents(50),
  ]);
  return (
    <ColigoPaySurveillance overview={overview} audit={audit} events={events} />
  );
}
