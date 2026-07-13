import { Clock, LogOut, MailQuestion, XCircle } from "lucide-react";
import { logout } from "@/app/(merchant)/actions";
import { Logo } from "@/components/shared/logo";
import { IdvCallout } from "@/components/idv/idv-callout";
import { APP_CONFIG } from "@/lib/config/app-config";

/**
 * Écran affiché à un commerçant dont le compte n'est pas (encore) approuvé
 * (mig 0273). Couvre tout l'espace commerçant via MerchantShell : tant que le
 * super-admin n'a pas validé, la boutique est invisible des clients et ne peut
 * pas recevoir de commande — ici on l'explique au lieu d'un dashboard vide.
 */
export async function MerchantPendingScreen({
  status,
  reason,
  merchantName,
}: {
  status: "pending" | "rejected";
  reason: string | null;
  merchantName: string;
}) {
  const rejected = status === "rejected";

  return (
    <div className="bg-surface-2 flex min-h-screen flex-col items-center justify-center p-6">
      <div className="border-border bg-surface w-full max-w-md rounded-[20px] border p-7 text-center shadow-sm">
        <div className="mb-5 flex justify-center">
          <Logo size="md" />
        </div>

        <div
          className={
            "mx-auto mb-4 flex size-14 items-center justify-center rounded-full " +
            (rejected
              ? "bg-danger-50 text-danger-600"
              : "bg-warning-50 text-warning-700")
          }
        >
          {rejected ? (
            <XCircle className="size-7" />
          ) : (
            <Clock className="size-7" />
          )}
        </div>

        <h1 className="text-xl font-bold tracking-tight">
          {rejected
            ? "Inscription non validée"
            : "Compte en cours de validation"}
        </h1>

        {/* Vérification d'identité du TITULAIRE (IDV) : le commerçant peut la
            faire pendant que l'équipe Coligo examine son inscription. La
            bannière disparaît si elle n'est pas publiée pour ce profil ou si
            l'identité est déjà vérifiée. */}
        <div className="mt-4 text-left">
          <IdvCallout profile="merchant" />
        </div>

        <p className="text-muted mt-2 text-sm">
          {rejected ? (
            <>
              La demande d&apos;inscription de{" "}
              <strong className="text-foreground">{merchantName}</strong>{" "}
              n&apos;a pas été retenue.
            </>
          ) : (
            <>
              Merci ! La demande d&apos;inscription de{" "}
              <strong className="text-foreground">{merchantName}</strong> a bien
              été reçue. Notre équipe la vérifie — vous serez activé dès
              qu&apos;elle sera approuvée. Votre boutique n&apos;est pas encore
              visible des clients.
            </>
          )}
        </p>

        {rejected && reason && (
          <p className="border-danger-200 bg-danger-50 text-danger-700 mt-4 rounded-[12px] border px-3 py-2 text-left text-sm">
            <span className="font-semibold">Motif :</span> {reason}
          </p>
        )}

        <a
          href={`mailto:${APP_CONFIG.contact.supportEmail}`}
          className="text-primary-700 hover:bg-primary-50 mt-5 inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-semibold transition-colors"
        >
          <MailQuestion className="size-4" />
          Contacter le support
        </a>

        <form action={logout} className="border-border mt-5 border-t pt-5">
          <button
            type="submit"
            className="text-muted hover:bg-surface-2 hover:text-foreground inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors"
          >
            <LogOut className="size-4" />
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  );
}
