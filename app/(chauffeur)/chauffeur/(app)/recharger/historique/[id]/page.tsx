import { Suspense } from "react";
import { PayEntryDetail } from "@/components/wallet/pay/pay-entry-detail";

/** Détail d'une opération Coligo Pay — reçu financier. */
export default async function ChauffeurPayEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PayEntryDetail base="/chauffeur" id={id} />
      </Suspense>
    </div>
  );
}
