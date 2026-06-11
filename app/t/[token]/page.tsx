import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import { ShareTrackView } from "@/components/customer/drive/share-track-view";

export const dynamic = "force-dynamic";

const sora = Sora({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-sora",
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-jakarta",
});

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
    <div className={`${sora.variable} ${jakarta.variable} drive-jakarta`}>
      <ShareTrackView token={token} />
    </div>
  );
}
