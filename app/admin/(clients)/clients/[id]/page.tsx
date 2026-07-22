import { notFound } from "next/navigation";
import { getCustomerDetail } from "@/lib/data/admin-customers";
import { CustomerDetailView } from "@/components/admin/clients/customer-detail-view";

export const dynamic = "force-dynamic";

/** Fiche client : identité, activité, suspension, coupures, positions. */
export default async function AdminClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  return <CustomerDetailView detail={detail} />;
}
