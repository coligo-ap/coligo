/**
 * Réglages système de l'appareil — ouverture de la FICHE DE L'APPLICATION.
 *
 * Sert aux écrans bloquants de permission (localisation obligatoire chauffeur /
 * livreur) : quand l'utilisateur a coché « Ne plus demander », l'OS ne
 * représentera JAMAIS le dialogue natif. Le seul chemin restant est la page des
 * réglages de l'app — c'est exactement ce que font Uber, Bolt et Yassir.
 *
 * - Android : Paramètres › Applications › Coligo › Autorisations
 *   (`ACTION_APPLICATION_DETAILS_SETTINGS`), ou l'écran « Position » du système
 *   quand c'est le GPS lui-même qui est éteint.
 * - iOS : la page de réglages de l'app. C'est le SEUL écran qu'Apple autorise à
 *   ouvrir — viser un autre écran expose à un refus en revue App Store (cf.
 *   l'avertissement du plugin), donc les deux fonctions y mènent au même endroit.
 * - Web (PWA / navigateur) : aucune API ne permet d'ouvrir les réglages du
 *   navigateur — les fonctions renvoient `false` et l'appelant affiche des
 *   instructions écrites à la place.
 *
 * Le plugin (`capacitor-native-settings`, MIT) est importé DYNAMIQUEMENT et
 * seulement en natif : le bundle web n'embarque rien.
 */

import { isNative, getNativePlatform } from "./context";

/**
 * Vrai si l'appareil peut ouvrir ses réglages depuis l'app (APK/IPA Capacitor).
 * Sur le web, l'appelant doit afficher la marche à suivre écrite.
 */
export function canOpenAppSettings(): boolean {
  return isNative();
}

/** Cible Android : fiche de l'app (autorisations) ou écran « Position ». */
type AndroidTarget = "app" | "location";

async function openNative(target: AndroidTarget): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { NativeSettings, AndroidSettings, IOSSettings } =
      await import("capacitor-native-settings");
    // iOS : uniquement la page de l'app (seule autorisée par Apple).
    if (getNativePlatform() === "ios") {
      const res = await NativeSettings.openIOS({ option: IOSSettings.App });
      return res?.status !== false;
    }
    const res = await NativeSettings.openAndroid({
      option:
        target === "location"
          ? AndroidSettings.Location
          : AndroidSettings.ApplicationDetails,
    });
    return res?.status !== false;
  } catch {
    // APK antérieur à l'ajout du plugin (le web se déploie AVANT le binaire),
    // ou refus de l'OS : on ne casse rien, l'écran appelant retombe sur les
    // instructions écrites.
    return false;
  }
}

/** Ouvre la fiche de l'application (autorisations) dans les réglages. */
export function openAppSettings(): Promise<boolean> {
  return openNative("app");
}

/**
 * Ouvre les réglages de LOCALISATION du système. À utiliser quand le service de
 * localisation lui-même est ÉTEINT : l'autorisation de l'app ne sert à rien
 * tant que le GPS du téléphone est coupé.
 */
export function openLocationSettings(): Promise<boolean> {
  return openNative("location");
}
