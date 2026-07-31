"use client";

// =============================================================================
// BARRE DE STATUT « intégrée » (edge-to-edge) — contraste AUTOMATIQUE.
//
// L'app peint sous la barre système (MainActivity : setDecorFitsSystemWindows
// false + barres transparentes). Reste à choisir la couleur des ICÔNES
// système (heure, réseau, batterie) : blanches sur un en-tête violet, sombres
// sur un fond clair. Plutôt que de maintenir une liste d'écrans, on ÉCHANTILLONNE
// la couleur réellement affichée juste sous la barre et on décide par luminance
// — automatiquement juste, y compris sur les nouveaux écrans et en mode sombre.
//
// Accès au plugin par le pont `window.Capacitor.Plugins.StatusBar` (PAS
// d'import du paquet) : le bundle web reste propre et un vieil APK sans le
// plugin ignore simplement l'appel (no-op).
// =============================================================================

type StatusBarPlugin = {
  setStyle?: (o: { style: "DARK" | "LIGHT" }) => Promise<void>;
  setOverlaysWebView?: (o: { overlay: boolean }) => Promise<void>;
  setBackgroundColor?: (o: { color: string }) => Promise<void>;
};

function plugin(): StatusBarPlugin | null {
  if (typeof window === "undefined") return null;
  return (
    (
      window as unknown as {
        Capacitor?: { Plugins?: { StatusBar?: StatusBarPlugin } };
      }
    ).Capacitor?.Plugins?.StatusBar ?? null
  );
}

/** Luminance perçue (0 = noir, 1 = blanc) d'une couleur CSS rgb()/rgba(). */
function luminance(css: string): number | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a] = m[1].split(",").map((v) => parseFloat(v.trim()));
  if (a === 0) return null; // transparent : on continue de remonter
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Couleur de fond EFFECTIVE au point (x, y) — remonte les parents transparents. */
function backgroundAt(x: number, y: number): number | null {
  let el: Element | null = document.elementFromPoint(x, y);
  while (el) {
    const l = luminance(getComputedStyle(el).backgroundColor);
    if (l != null) return l;
    el = el.parentElement;
  }
  const l = luminance(getComputedStyle(document.body).backgroundColor);
  return l ?? 1; // par défaut : fond clair
}

/**
 * Applique le bon style d'icônes. `style: "LIGHT"` = icônes CLAIRES (fond
 * sombre) ; `"DARK"` = icônes sombres (fond clair) — nomenclature Capacitor.
 */
export function syncStatusBar(): void {
  const p = plugin();
  if (!p?.setStyle) return;
  try {
    // On échantillonne 3 points juste sous la barre (gauche/centre/droite) :
    // un en-tête peut être partiellement coloré (pilule, dégradé).
    const y = 6;
    const xs = [
      window.innerWidth * 0.15,
      window.innerWidth * 0.5,
      window.innerWidth * 0.85,
    ];
    const ls = xs
      .map((x) => backgroundAt(x, y))
      .filter((v): v is number => v != null);
    if (ls.length === 0) return;
    const avg = ls.reduce((s, v) => s + v, 0) / ls.length;
    void p.setStyle({ style: avg < 0.6 ? "LIGHT" : "DARK" });
    // La barre reste transparente : le contenu web passe dessous.
    void p.setOverlaysWebView?.({ overlay: true });
    void p.setBackgroundColor?.({ color: "#00000000" });
  } catch {
    /* plugin absent (vieil APK) ou fenêtre détruite : sans effet */
  }
}
