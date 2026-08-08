"use client";

import Link from "next/link";
import { useLocale } from "next-intl";

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
  loginLabel,
  signupLabel,
}: {
  mode: AuthMode;
  loginHref: string;
  signupHref: string;
  /** Optionnels : par défaut, libellés bilingues FR/AR selon la locale. */
  loginLabel?: string;
  signupLabel?: string;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const login = loginLabel ?? tr("J'ai déjà un compte", "لديّ حساب بالفعل");
  const signup = signupLabel ?? tr("Je crée mon compte", "أنشئ حسابي");
  // `min-h-[44px]` : cible tactile minimale au doigt (garde-fou mesuré au
  // navigateur — ne pas descendre). `whitespace-nowrap` + text-xs : le libellé
  // tient sur UNE ligne → l'onglet reste à 44 px au lieu de gonfler à deux
  // lignes (gain vertical sur tous les portails).
  // `min-w-0` + `truncate` : avec une POLICE SYSTÈME AGRANDIE (réglage
  // « Taille de police » d'Android/iOS), un libellé en `whitespace-nowrap`
  // débordait de la pilule. Il se tronque désormais proprement (…) au lieu de
  // sortir du cadre, et la cible tactile reste à 44 px.
  const base =
    "flex min-h-[44px] min-w-0 flex-1 items-center justify-center rounded-control px-2 py-1 text-center text-xs font-semibold transition";
  const active = "bg-white text-foreground";
  const idle = "text-muted hover:text-foreground";

  return (
    <nav
      aria-label={tr(
        "Connexion ou création de compte",
        "تسجيل الدخول أو إنشاء حساب"
      )}
      className="bg-surface-2 border-border mb-2.5 flex gap-1 rounded-md border p-1"
    >
      <Link
        href={loginHref}
        aria-current={mode === "login" ? "page" : undefined}
        className={`${base} ${mode === "login" ? active : idle}`}
      >
        <span className="min-w-0 truncate">{login}</span>
      </Link>
      <Link
        href={signupHref}
        aria-current={mode === "signup" ? "page" : undefined}
        className={`${base} ${mode === "signup" ? active : idle}`}
      >
        <span className="min-w-0 truncate">{signup}</span>
      </Link>
    </nav>
  );
}
