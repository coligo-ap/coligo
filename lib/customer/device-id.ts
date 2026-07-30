"use client";

// =============================================================================
// Identifiant d'APPAREIL (anti-fraude promos, façon Uber/Deliveroo).
//
// DEUX niveaux, du plus fort au plus faible :
//  1. APP INSTALLÉE : identifiant MATÉRIEL via @capacitor/device (pont
//     window.Capacitor.Plugins.Device, PAS d'import → bundle web propre) —
//     Android = ANDROID_ID (stable par appareil+clé de signature : SURVIT à
//     la désinstallation/réinstallation et à la déconnexion) ; iOS =
//     identifierForVendor (survit tant qu'une app Coligo reste installée).
//     Préfixé « nat: » pour distinguer les marques FIABLES côté serveur.
//  2. WEB / repli : UUID localStorage (déterrent de première ligne — un
//     client web peut l'effacer, le serveur garde per_customer_limit + IP/UA).
//
// Jamais utilisé pour autre chose que l'anti-abus (promotion, appareil).
// =============================================================================

const KEY = "coligo:device-id";

function localUuid(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Stockage indisponible (navigation privée stricte) : pas d'identifiant —
    // le serveur garde ses autres gardes (per_customer_limit, IP/UA).
    return null;
  }
}

/** Version synchrone (repli localStorage seul) — conservée pour compat. */
export function getDeviceId(): string | null {
  return localUuid();
}

type DevicePlugin = { getId?: () => Promise<{ identifier?: string }> };

/**
 * Identifiant d'appareil PHYSIQUE d'abord (app installée), UUID local sinon.
 * Best-effort : toute erreur du pont natif retombe sur le repli — un vieil
 * APK sans le plugin continue de fonctionner à l'identique.
 */
export async function getDeviceIdAsync(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const dev = (
      window as unknown as {
        Capacitor?: { Plugins?: { Device?: DevicePlugin } };
      }
    ).Capacitor?.Plugins?.Device;
    if (dev?.getId) {
      try {
        const { identifier } = await dev.getId();
        if (identifier && identifier.length >= 8) return `nat:${identifier}`;
      } catch {
        /* pont indisponible → repli */
      }
    }
  }
  return localUuid();
}
