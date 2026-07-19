import { Suspense } from "react";
import { PayEntryDetail } from "@/components/wallet/pay/pay-entry-detail";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";

/** Détail d'une opération Coligo Pay — reçu financier. */
export default async function MerchantPayEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PayEntryDetail base="" id={id} />
      </Suspense>
    </div>
  );
}
