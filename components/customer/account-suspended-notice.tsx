import Link from "next/link";
import { Ban } from "lucide-react";

// =============================================================================
// Bandeau « compte suspendu » (mig 0397) — affiché sur TOUT l'espace client.
//
// Volontairement NON masquable, et volontairement non bloquant : le client
// garde l'accès à son historique et au support. Il apprend l'état de son compte
// ICI, pas au moment de payer.
// =============================================================================

export function AccountSuspendedNotice({ reason }: { reason: string | null }) {
  return (
    <div
      role="alert"
      className="border-danger-200 bg-danger-50 text-danger-900 mx-4 mt-3 flex items-start gap-3 rounded-[16px] border px-4 py-3.5 lg:mx-6"
    >
      <Ban className="text-danger-600 mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">Compte suspendu</p>
        <p className="text-danger-800 mt-1 leading-relaxed">
          {reason
            ? `${reason} — vos commandes et courses sont bloquées.`
            : "Vos commandes et vos courses sont bloquées pour le moment."}{" "}
          <Link href="/centre-aide" className="font-semibold underline">
            Contacter le support
          </Link>
        </p>
      </div>
    </div>
  );
}
