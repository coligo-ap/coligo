import { getAuthUser } from "@/lib/auth/session";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import { CustomerHeader } from "@/components/customer/customer-header";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { CustomerFooter } from "@/components/customer/customer-footer";
import { CartMonoProvider } from "@/components/customer/cart-mono-provider";
import { ClientThemeScope } from "@/components/customer/client-theme-scope";
import { PushRegistrar } from "@/components/native/push-registrar";
import { TawkChat } from "@/components/support/tawk-chat";

/**
 * Chrome client : header (desktop + mobile), bottom-nav (mobile), footer (desktop).
 * Charge l'auth pour adapter le header (compte vs se-connecter) — pas de
 * blocage : la navigation est libre sans compte.
 *
 * `hideHeader` = true si une page porte elle-même sa navigation (zone +
 * compte + panier) et n'a pas besoin du header sticky du shell.
 */
export async function CustomerShell({
  children,
  hideHeader = false,
}: {
  children: React.ReactNode;
  hideHeader?: boolean;
}) {
  // PERF : auth + profil client + feature flags MÉMOÏSÉS et partagés avec la
  // page hôte (cette coque est rendue par CHAQUE page client, pas de layout
  // partagé) → un seul `auth.getUser` + une seule requête `customers` par rendu
  // au lieu de deux (coque + page). Tout est lancé en parallèle.
  const [user, customer, flags] = await Promise.all([
    getAuthUser(),
    getCurrentCustomerFull(),
    getFeatureFlags(),
  ]);

  // Onglets retirés de la nav si la fonctionnalité est « masquée » (super-admin).
  const hiddenKeys: string[] = [];
  if (flags.drive.status === "hidden") hiddenKeys.push("drive");
  if (flags.coligo_pay.status === "hidden") hiddenKeys.push("pay");

  const customerName = customer?.full_name ?? null;
  const customerPhone = customer?.phone ?? null;

  return (
    <div data-space="client" className="bg-surface-2 min-h-screen">
      <ClientThemeScope />
      {!hideHeader && (
        <CustomerHeader isAuth={!!user} customerName={customerName} />
      )}
      <main className="pb-20 lg:pb-0">
        <CartMonoProvider>{children}</CartMonoProvider>
      </main>
      <CustomerFooter />
      <CustomerBottomNav hiddenKeys={hiddenKeys} />

      {/* Enregistrement du token FCM (no-op hors APK Capacitor, et n'agit
          que si l'utilisateur est connecté — sinon l'endpoint répondra 401
          et le registrar abandonne silencieusement). */}
      {user && <PushRegistrar role="customer" />}

      {/* Live chat support (Tawk.to) — lanceur masqué, ouvert via « Aide ».
          Contexte max pour l'agent : nom, e-mail, tél, et statut du compte. */}
      <TawkChat
        role="client"
        name={customerName}
        email={user?.email ?? null}
        phone={customerPhone}
        attributes={{
          Compte: user ? "Connecté" : "Visiteur",
          "ID client": user?.id,
        }}
      />
    </div>
  );
}
