import { PARTNER_FONT_VARS } from "@/lib/fonts";
import { ShareTrackView } from "@/components/customer/drive/share-track-view";

export const dynamic = "force-dynamic";

/**
 * Partage de trajet PUBLIC (sans compte) — coligo.app/t/{token}.
 * Position live du véhicule, plaque, note du chauffeur, ETA.
 */
export default async function ShareTrackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className={`${PARTNER_FONT_VARS} drive-jakarta`}>
      <ShareTrackView token={token} />
    </div>
  );
}
