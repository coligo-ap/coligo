import type { Metadata } from "next";
import { pwaMetadata } from "@/lib/config/pwa";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import "./maquette.css";
import { ConfirmProvider } from "@/components/ui/confirm";
import { OfflineSyncIndicator } from "@/components/driver/offline-sync-indicator";
import { DriverDispatchMount } from "@/components/driver/driver-dispatch-mount";
import { TourDispatchMount } from "@/components/driver/tour-dispatch-mount";
import { PushRegistrar } from "@/components/native/push-registrar";
import { ActiveCourseBanner } from "@/components/driver/active-course-banner";
import { DriverCancelWatch } from "@/components/driver/driver-cancel-watch";
import { DriverThemeRoot } from "@/components/driver/driver-theme-root";
import { PersistentDriverMap } from "@/components/driver/home/persistent-driver-map";
import { createClient } from "@/lib/supabase/server";
import { TawkChat } from "@/components/support/tawk-chat";
import { DriverBlockedScreen } from "@/components/driver/driver-blocked-screen";
import { DriverInstallBanner } from "@/components/driver/driver-install-banner";
import { getCurrentDriver } from "@/lib/auth/driver";
import { getDriverGate } from "@/lib/auth/driver-gate";
import { APP_CONFIG } from "@/lib/config/app-config";

/**
 * Layout du groupe (driver). Volontairement MINIMAL : chaque page gère son
 * propre chrome (DriverShell pour les pages app, AuthNavBar+AuthFooter pour
 * login/signup). Le layout ne pose que les composants globaux : install
 * banner PWA + processeur de file offline.
 *
 * Refonte « style Uber » : tout l'espace livreur est scopé via
 * `data-space="driver"` (cf. globals.css) → police Inter + palette dédiée
 * (fond gris, cards blanches, boutons noirs, violet rare). Le `@theme` global
 * de l'app (commerçant/client/admin) n'est PAS touché.
 */
// Polices EXACTES des maquettes : Sora (titres/chiffres) + Plus Jakarta Sans
// (corps). Exposées en variables CSS consommées par app/(driver)/maquette.css.
const fontSora = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sora",
  weight: ["500", "600", "700", "800"],
});
const fontJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700"],
});

// Titre propre à l'espace livreur (le layout racine est neutre « Coligo ») —
// sinon Tawk.to annonçait « Espace commerçant » pour un livreur.
// + PWA dédiée (manifest/icône/nom « Coligo Livreur »).
export const metadata: Metadata = {
  title: `${APP_CONFIG.name} — Espace livreur`,
  ...pwaMetadata("livreur"),
};

export default async function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // BLOCAGE (sanction dure) : un livreur bloqué n'a AUCUN accès à ses pages —
  // quel que soit l'onglet, on n'affiche que l'écran de blocage (+ la nav).
  // Le GEL (souple) laisse au contraire l'accès aux pages (géré écran par écran).
  const driver = await getCurrentDriver();
  if (driver?.is_blocked) {
    return (
      <DriverThemeRoot
        fontVars={`${fontSora.variable} ${fontJakarta.variable}`}
      >
        <DriverBlockedScreen reason={driver.block_reason} />
      </DriverThemeRoot>
    );
  }

  // Compte ACTIF = vérifié par l'équipe Coligo et parcours d'inscription
  // terminé. Tant qu'il ne l'est pas, on ne monte AUCUN organe opérationnel :
  // ni carte, ni réception Express, ni dispatch tournée, ni bandeau de course.
  // Ces composants sont ce qui rendrait une mise en ligne possible depuis un
  // écran d'inscription — ils n'existent tout simplement pas pour lui.
  const gate = await getDriverGate();
  const isActive = gate?.stage === "active";

  // Pins commerçants (coordonnées) pour la carte PERSISTANTE de l'accueil.
  // Requête UNE fois par session : le layout ne se re-rend pas entre onglets,
  // donc la carte (montée ici) n'est jamais recréée à chaque navigation.
  let mapPins: { id: string; name: string; lat: number; lng: number }[] = [];
  if (isActive && driver) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("merchant_drivers")
      .select("id, status, merchants ( name, latitude, longitude )")
      .eq("driver_id", driver.id)
      .eq("status", "active");
    type M = {
      name: string;
      latitude: number | null;
      longitude: number | null;
    };
    const one = (v: M | M[] | null): M | null =>
      Array.isArray(v) ? (v[0] ?? null) : v;
    mapPins = (data ?? [])
      .map((l) => {
        const m = one(l.merchants as M | M[] | null);
        return m && m.latitude != null && m.longitude != null
          ? {
              id: l.id as string,
              name: m.name,
              lat: m.latitude,
              lng: m.longitude,
            }
          : null;
      })
      .filter(
        (p): p is { id: string; name: string; lat: number; lng: number } =>
          p !== null
      );
  }

  return (
    <DriverThemeRoot fontVars={`${fontSora.variable} ${fontJakarta.variable}`}>
      {/* Sans ce fournisseur, `useConfirm()` retombe SILENCIEUSEMENT sur la boîte
          de dialogue native du navigateur. Le livreur était le seul espace à ne
          pas le monter (client, commerçant et admin le font). Il enveloppe TOUT
          l'espace, pas seulement `children` : le bandeau de course et la veille
          d'annulation sont des frères de `children` et doivent en bénéficier. */}
      <ConfirmProvider>
        {/* Carte de l'accueil montée UNE fois (persiste entre onglets) ; en fond,
            affichée seulement sur /driver (cf. PersistentDriverMap). */}
        {isActive && <PersistentDriverMap pins={mapPins} />}
        {children}
        {/* Enregistre le token FCM du livreur (role=courier) → reçoit les push
          Express ET Tournée même app fermée / hors ligne (Android natif).
          Monté DÈS la création du compte : c'est ce qui permet de le prévenir
          que l'équipe Coligo a validé son inscription. */}
        {driver && <PushRegistrar role="courier" />}
        {/* Organes opérationnels : réservés au compte activé. */}
        {isActive && (
          <>
            {/* Réception Express globale (pilotée par l'intention « en ligne »). */}
            <DriverDispatchMount userId={driver?.user_id ?? null} />
            {/* Notification TOURNÉE temps réel (bandeau in-app) chez les commerçants
              où le livreur est inscrit — distinct de l'Express. */}
            <TourDispatchMount />
            {/* Bandeau « Course en cours » réductible, épinglé sur tous les onglets. */}
            <ActiveCourseBanner />
            {/* STOP temps réel : pop-up si la course active est annulée. */}
            <DriverCancelWatch />
          </>
        )}
        {/* Live chat support (Tawk.to) — lanceur masqué, ouvert via « Aide & support ».
          Contexte max pour l'agent : identité + statut du livreur. */}
        <TawkChat
          role="livreur"
          name={driver?.full_name ?? null}
          phone={driver?.phone ?? null}
          attributes={{
            "ID livreur": driver?.id,
            Vérifié: driver?.is_verified,
            Gelé: driver?.is_frozen,
          }}
        />
        {/* Bannière d'installation consciente de la route : jamais masquée par
          la barre En ligne / le bandeau course de l'accueil. */}
        <DriverInstallBanner />
        <OfflineSyncIndicator />
      </ConfirmProvider>
    </DriverThemeRoot>
  );
}
