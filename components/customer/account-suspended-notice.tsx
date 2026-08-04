import Link from "next/link";
import { Ban, ShieldAlert } from "lucide-react";

// =============================================================================
// COMPTE SUSPENDU / VÉRIFICATION EXIGÉE — fenêtre BLOQUANTE, plus un bandeau.
//
// Avant : un simple message en haut de page. Le client le faisait défiler,
// continuait à remplir son panier, et ne comprenait qu'au moment de payer que
// son compte était bloqué. C'est le pire moment pour l'apprendre.
//
// Désormais : une fenêtre PLEIN ÉCRAN, où qu'il se trouve dans l'application,
// qu'il ne peut PAS fermer — la seule sortie est le support (ou la
// vérification d'identité selon le cas). Une mesure de sécurité qu'on balaie
// d'un geste n'est pas une mesure.
//
// Fond OPAQUE et non translucide : rien de l'écran précédent ne doit rester
// manipulable derrière. Sur mobile, un simple voile laisse encore passer des
// taps selon les navigateurs.
// =============================================================================

export function AccountSuspendedNotice({
  reason,
  variant = "suspended",
}: {
  reason: string | null;
  /** `idv` : le compte n'est pas suspendu, une vérification est exigée. */
  variant?: "suspended" | "idv";
}) {
  const isIdv = variant === "idv";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="acct-block-title"
      className="bg-surface fixed inset-0 z-[200] flex flex-col items-center justify-center px-6 pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
    >
      <div className="w-full max-w-sm text-center">
        <span
          className={`mx-auto grid size-16 place-items-center rounded-2xl ${
            isIdv
              ? "bg-warning-100 text-warning-700"
              : "bg-danger-100 text-danger-700"
          }`}
        >
          {isIdv ? (
            <ShieldAlert className="size-8" />
          ) : (
            <Ban className="size-8" />
          )}
        </span>

        <h1
          id="acct-block-title"
          className="text-foreground mt-5 text-xl font-extrabold"
        >
          {isIdv ? "Vérification d'identité requise" : "Compte suspendu"}
        </h1>

        <p className="text-muted mt-2 text-sm leading-relaxed">
          {reason
            ? reason
            : isIdv
              ? "Pour continuer à utiliser Coligo, votre identité doit être vérifiée."
              : "Vos commandes et vos courses sont bloquées pour le moment."}
        </p>

        <Link
          href={isIdv ? "/idv" : "/centre-aide"}
          className="bg-primary-600 hover:bg-primary-700 mt-6 block rounded-[14px] px-4 py-3.5 text-sm font-extrabold text-white transition-colors"
        >
          {isIdv ? "Vérifier mon identité" : "Contacter le support"}
        </Link>

        <p className="text-subtle mt-4 text-xs">
          {isIdv
            ? "La vérification prend quelques minutes."
            : "Notre équipe vous répond depuis le centre d'aide."}
        </p>
      </div>
    </div>
  );
}
