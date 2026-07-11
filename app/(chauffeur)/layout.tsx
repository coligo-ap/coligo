import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import { pwaMetadata } from "@/lib/config/pwa";
import { RouteRefreshOnFocus } from "@/components/shared/route-refresh-on-focus";
import { ConnectionGuard } from "@/components/shared/connection-guard";
import { TawkChat } from "@/components/support/tawk-chat";
import { getCurrentChauffeur } from "@/lib/auth/chauffeur";

export const dynamic = "force-dynamic";

// Titre propre à l'espace chauffeur + PWA dédiée (« Coligo Drive »).
export const metadata: Metadata = {
  title: "Coligo Drive — Espace chauffeur",
  ...pwaMetadata("drive"),
};

// Polices de la maquette Drive (Sora titres/prix, Jakarta corps).
const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-sora",
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
});

/**
 * Espace CHAUFFEUR VTC (population séparée des livreurs). L'isolation de session
 * (confinement à /chauffeur) est gérée par le middleware via le domaine e-mail
 * `@chauffeurs.coligo.local`.
 */
export default async function ChauffeurLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Identité chauffeur (pour le contexte support Tawk — best-effort, null sur
  // les pages login/signup où aucune session n'existe encore).
  const chauffeur = await getCurrentChauffeur();
  return (
    <div
      className={`${sora.variable} ${jakarta.variable} drive-jakarta min-h-screen bg-[var(--d-surface)]`}
    >
      {/* Refresh doux des données au retour au premier plan (complément du
          Router Cache : retour instantané puis maj asynchrone du RSC). */}
      <RouteRefreshOnFocus />
      {/* Garde de connexion : bandeau persistant + reprise SONDÉE (jamais « en
          ligne » sans paquet confirmé), mode Avion inclus. z-[300], au-dessus
          de la carte Drive et des feuilles. */}
      <ConnectionGuard />
      {/* Contexte support : rôle Chauffeur + identité, mémorisé (Tawk chargé
          seulement au clic « Aide »). */}
      <TawkChat
        role="chauffeur"
        name={chauffeur?.full_name ?? null}
        phone={chauffeur?.phone ?? null}
        attributes={{
          "ID chauffeur": chauffeur?.id,
          Vérifié: chauffeur?.is_verified,
          Gelé: chauffeur?.is_frozen,
          "Plaque véhicule": chauffeur?.vehicle_plate,
        }}
      />
      {children}
    </div>
  );
}
