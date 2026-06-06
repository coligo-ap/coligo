import { EncaisserView } from "@/components/merchant/encaisser-view";

export const dynamic = "force-dynamic";

// =============================================================================
// /encaisser — encaissement Coligo Pay par QR (commerçant).
// L'auth + la résolution boutique sont gérées par la coque (MerchantShell).
// =============================================================================
export default function EncaisserPage() {
  return <EncaisserView />;
}
