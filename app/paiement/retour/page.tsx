import { CheckCircle2, XCircle } from "lucide-react";

export const metadata = {
  title: "Paiement — Coligo",
  robots: { index: false, follow: false },
};

/**
 * Page de RETOUR Chargily pour les paiements ouverts dans le navigateur
 * INTÉGRÉ de l'app (Custom Tabs / SFSafariViewController). Cet onglet ne
 * partage PAS la session de l'app → la page est PUBLIQUE et minimale : le
 * vrai résultat (solde crédité, écran de succès) est déjà affiché DANS
 * l'application, qui polle la confirmation webhook. Ici : un seul message —
 * revenez à l'app.
 */
export default async function PaiementRetourPage({
  searchParams,
}: {
  searchParams: Promise<{ topup?: string }>;
}) {
  const { topup } = await searchParams;
  const ok = topup !== "failed";
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f5f9] p-6">
      <div className="rounded-sheet-xl w-full max-w-sm bg-white px-6 py-10 text-center shadow-sm">
        {ok ? (
          <CheckCircle2 className="mx-auto size-12 text-[#16b364]" />
        ) : (
          <XCircle className="mx-auto size-12 text-[#e5484d]" />
        )}
        <p className="text-title-lg mt-4 font-extrabold text-[#0b0c12]">
          {ok ? "Paiement terminé" : "Paiement non abouti"}
        </p>
        <p className="text-body-sm mt-1.5 leading-snug text-[#6b7280]">
          Fermez cette fenêtre et revenez à l&apos;application Coligo —{" "}
          {ok
            ? "votre confirmation s'y affiche automatiquement."
            : "vous pourrez réessayer depuis l'application."}
        </p>
      </div>
    </main>
  );
}
