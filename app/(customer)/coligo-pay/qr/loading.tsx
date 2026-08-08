/**
 * Squelette du SCANNER QR Coligo Pay — plein écran sombre (coque propre) :
 * cadre de visée fantôme au centre, le tap répond immédiatement au lieu d'un
 * écran figé le temps du serveur.
 */
export default function ColigoPayQrLoading() {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#0B0C12]">
      <div className="flex flex-col items-center gap-6">
        <div className="rounded-panel size-56 animate-pulse border-2 border-white/25 bg-white/5" />
        <div className="h-4 w-48 animate-pulse rounded bg-white/15" />
      </div>
    </div>
  );
}
