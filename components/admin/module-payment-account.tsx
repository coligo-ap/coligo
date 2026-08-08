import {
  getPaymentAccounts,
  type PaymentScope,
} from "@/app/admin/recharges/actions";
import { PaymentAccountsEditor } from "@/components/admin/payment-accounts-editor";

/**
 * Bloc « Compte de versement de la plateforme » pour UN module, à insérer dans
 * la page admin de ce module (livreurs / chauffeurs / commerçants / agents).
 * Même donnée que la vue centrale /admin/recharges (table par scope) : l'édition
 * ici se reflète partout. L'utilisateur du module verra ce CCP/RIB dans sa
 * page de recharge par virement.
 */
export async function ModulePaymentAccount({ scope }: { scope: PaymentScope }) {
  const account = (await getPaymentAccounts()).find((a) => a.scope === scope);
  if (!account) return null; // non super-admin (ou table vide)
  return (
    <section className="border-border bg-surface rounded-lg border p-5">
      <div className="mb-4">
        <h2 className="text-foreground text-base font-bold">
          Compte de versement de la plateforme
        </h2>
        <p className="text-muted text-sm">
          CCP / compte bancaire affiché à ces utilisateurs pour recharger par
          virement. Modifiable aussi depuis /admin/recharges.
        </p>
      </div>
      <PaymentAccountsEditor accounts={[account]} />
    </section>
  );
}
