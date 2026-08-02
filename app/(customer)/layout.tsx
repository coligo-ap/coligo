import { getAuthUser } from "@/lib/auth/session";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { getEffectiveFlags } from "@/lib/data/feature-flags";
import { getAppTheme } from "@/lib/data/app-theme";
import { getCustomerFraudGate } from "@/lib/fraud/gate";
import { getMyAccountBlock } from "@/lib/data/account-status";
import { AccountSuspendedNotice } from "@/components/customer/account-suspended-notice";
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
  const [user, customer, flags, fraudGate, accountBlock, appTheme] =
    await Promise.all([
      getAuthUser(),
      getCurrentCustomerFull(),
      getEffectiveFlags(),
      getCustomerFraudGate(),
      getMyAccountBlock(),
      // Thème « occasion » (mig 0415/0416) — lecture en cache, coût nul.
      getAppTheme(),
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
        homeTheme={appTheme.marketplaceHero ? { theme: appTheme.theme } : null}
      >
        {/* Dialogues designés (confirm/prompt) pour tout l'espace client —
            remplace window.confirm/prompt (ex. vider le panier). */}
        {/* Compte suspendu par l'équipe Coligo : le client l'apprend ici, pas
            au moment de payer. */}
        {/* DEUX sources de suspension, et il faut les DEUX : le blocage de
            compte (mig 0397) et la mesure ANTI-FRAUDE (`suspend`). Seule la
            première était regardée — une suspension anti-fraude bloquait bien
            le paiement et les courses, mais le client n'en était jamais
            informé et continuait à naviguer comme si de rien n'était, sur le
            web comme dans les applications. */}
        {(accountBlock.blocked || fraudGate.suspended) && (
          <AccountSuspendedNotice
            reason={
              accountBlock.reason ??
              "Votre compte est suspendu par l'équipe Coligo à la suite de plusieurs situations suspectes."
            }
          />
        )}
        <ConfirmProvider>{children}</ConfirmProvider>
        {/* Anti-fraude : avertissement OBLIGATOIRE (impossible à fermer) après
            plusieurs situations suspectes — docs/ANTI-FRAUDE.md §7. */}
        {fraudGate.requireAck && <FraudAckGate />}
      </CustomerChrome>
    </CustomerQueryProvider>
  );
}
