import Link from "next/link";

export type AuthMode = "login" | "signup";

/**
 * Sélecteur « J'ai déjà un compte » / « Je crée mon compte », en tête de la
 * carte d'authentification.
 *
 * Le problème qu'il résout : un utilisateur arrivant sur « Espace livreur » ne
 * savait pas s'il était en train de se connecter ou de s'inscrire. La réponse se
 * trouvait dans un lien discret sous le formulaire — après le bouton, donc lu
 * trop tard. Ici, le choix est le PREMIER élément de la carte, l'onglet actif
 * dit où l'on est, l'autre dit où aller.
 *
 * Ce sont de vrais liens (`<Link>` prefetché), pas des onglets d'état : les deux
 * parcours restent des routes distinctes, partageables et gérées par le serveur.
 * Le lien de bas de carte devient donc inutile — le répéter dirait deux fois la
 * même chose sur le même écran.
 */
export function AuthModeTabs({
  mode,
  loginHref,
  signupHref,
  loginLabel = "J'ai déjà un compte",
  signupLabel = "Je crée mon compte",
}: {
  mode: AuthMode;
  loginHref: string;
  signupHref: string;
  /** Traduits par l'appelant (les portails livreur/chauffeur sont bilingues). */
  loginLabel?: string;
  signupLabel?: string;
}) {
  const base =
    "flex-1 rounded-[10px] px-3 py-2.5 text-center text-[13.5px] font-semibold transition";
  const active = "bg-white text-foreground shadow-sm";
  const idle = "text-muted hover:text-foreground";

  return (
    <nav
      aria-label="Connexion ou création de compte"
      className="bg-surface-2 border-border mb-6 flex gap-1 rounded-[12px] border p-1"
    >
      <Link
        href={loginHref}
        aria-current={mode === "login" ? "page" : undefined}
        className={`${base} ${mode === "login" ? active : idle}`}
      >
        {loginLabel}
      </Link>
      <Link
        href={signupHref}
        aria-current={mode === "signup" ? "page" : undefined}
        className={`${base} ${mode === "signup" ? active : idle}`}
      >
        {signupLabel}
      </Link>
    </nav>
  );
}
