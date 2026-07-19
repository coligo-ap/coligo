"use client";

// =============================================================================
// Retour haptique léger (paiements, confirmations) — sans dépendance native.
// =============================================================================
// Utilise l'API Vibration (Android WebView / Chrome). No-op silencieux là où
// elle n'existe pas (iOS WKWebView, desktop) — le haptique reste un +, jamais
// un prérequis. Motifs courts, façon retour système (succès = double tap doux,
// erreur = buzz plus marqué).
// =============================================================================

type HapticKind = "success" | "error" | "light";

const PATTERNS: Record<HapticKind, number | number[]> = {
  success: [18, 60, 28],
  error: [40, 40, 40],
  light: 12,
};

export function haptic(kind: HapticKind = "light"): void {
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(PATTERNS[kind]);
    }
  } catch {
    /* API indisponible / bloquée — sans effet */
  }
}
