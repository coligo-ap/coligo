/**
 * Helpers caméra pour le scanner QR.
 * Le composant React `<QrScanner />` consomme ces helpers — il ne touche
 * pas à `navigator.mediaDevices` ni à la Permissions API directement.
 */

export function cameraSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return !!navigator.mediaDevices?.getUserMedia;
}

export type CameraPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported";

/**
 * Permissions API (`camera`) n'est PAS supportée partout (Safari < 16, certains
 * Firefox). En cas d'indisponibilité on retombe sur `"prompt"` : on laissera
 * `getUserMedia` déclencher la demande à l'utilisateur, comportement
 * acceptable.
 */
export async function cameraPermissionState(): Promise<CameraPermissionState> {
  if (typeof navigator === "undefined") return "unsupported";
  if (!cameraSupported()) return "unsupported";
  const perms = navigator.permissions as
    | (Permissions & { query: typeof Permissions.prototype.query })
    | undefined;
  if (!perms?.query) return "prompt";
  try {
    const status = await perms.query({
      name: "camera" as PermissionName,
    });
    return status.state as CameraPermissionState;
  } catch {
    return "prompt";
  }
}
