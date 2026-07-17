import { getAuthUser } from "@/lib/auth/session";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import { getCustomerFraudGate } from "@/lib/fraud/gate";
import { FraudAckGate } from "@/components/customer/fraud-ack-gate";
import { CustomerQueryProvider } from "@/components/customer/customer-query-provider";
import { CustomerChrome } from "@/components/customer/customer-chrome";
import { ConfirmProvider } from "@/components/ui/confirm";

/**
 * Layout de groupe CLIENT — hôte PERSISTANT du cache TanStack Query ET du chrome
 * (header / bottom-nav / footer / providers). Les layouts Next ne se re-rendent
 * pas en naviguant entre pages d'un même groupe → la coque ne se RE-MONTE plus
 * à chaque navigation (fin du « rechargement complet ») et l'auth + le profil +
 * les feature flags sont résolus UNE FOIS par entrée dans l'espace (au lieu de
 * par page). Les pages n'ont plus qu'à rendre leur contenu.
 *
 * Dédup : ces helpers sont `cache()` → quand une page lit aussi l'auth/profil
 * dans le MÊME rendu, c'est partagé (pas de requête en double).
 */
export default async function CustomerGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, customer, flags, fraudGate] = await Promise.all([
    getAuthUser(),
    getCurrentCustomerFull(),
    getFeatureFlags(),
    getCustomerFraudGate(),
  ]);

  // Onglets retirés de la nav si la fonctionnalité est « masquée » (super-admin).
  const hiddenKeys: string[] = [];
  if (flags.drive.status === "hidden") hiddenKeys.push("drive");
  if (flags.coligo_pay.status === "hidden") hiddenKeys.push("pay");

  return (
    <CustomerQueryProvider>
      <CustomerChrome
        isAuth={!!user}
        customerName={customer?.full_name ?? null}
        customerPhone={customer?.phone ?? null}
        userEmail={user?.email ?? null}
        userId={user?.id ?? null}
        hiddenKeys={hiddenKeys}
      >
        {/* Dialogues designés (confirm/prompt) pour tout l'espace client —
            remplace window.confirm/prompt (ex. vider le panier). */}
        <ConfirmProvider>{children}</ConfirmProvider>
        {/* Anti-fraude : avertissement OBLIGATOIRE (impossible à fermer) après
            plusieurs situations suspectes — docs/ANTI-FRAUDE.md §7. */}
        {fraudGate.requireAck && <FraudAckGate />}
      </CustomerChrome>
    </CustomerQueryProvider>
  );
}
