// =============================================================================
// Marqueur « déconnexion VOLONTAIRE » — contrat partagé serveur ⇄ client.
//
// POURQUOI : le filet de session (SessionKeeper / session-keeper.ts) garde une
// COPIE des jetons hors des cookies pour ré-installer la session quand la WebView
// revient sans ses cookies (paiement externe, veille iOS). MAIS un `signOut()`
// via Server Action efface les cookies `sb-*` SANS garantir l'événement client
// `SIGNED_OUT`, et le JWT d'accès reste valide ~1 h : sans garde-fou, la copie
// pourrait RESSUSCITER une session que l'utilisateur a fermée exprès.
//
// Parade : chaque Server Action de logout pose ce cookie ; SessionKeeper le
// lit + l'efface AVANT toute restauration, purge la copie et ne restaure pas.
// Non sensible (dit juste « un logout a eu lieu ») → lisible par le client.
// =============================================================================

export const SIGNED_OUT_COOKIE = "coligo_signed_out";

// Doit couvrir la fenêtre où le JWT d'accès reste valide après signOut (TTL
// Supabase par défaut ~1 h) : le marqueur survit à un kill/réouverture juste
// après le logout, le temps que SessionKeeper le consomme une fois. Au-delà, le
// JWT expire et la restauration échoue d'elle-même (chemin d'erreur existant).
export const SIGNED_OUT_MAX_AGE = 60 * 60 * 2; // 2 h (marge)
