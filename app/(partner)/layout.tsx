import type { ReactNode } from "react";
import { TawkChat } from "@/components/support/tawk-chat";
import { getCurrentPartner } from "@/lib/auth/partner";

// Espace point de recharge partenaire — confiné à /partenaire par le middleware
// (isolation des rôles, email @partners.coligo.local).
export default async function PartnerLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Identité Agent Coligo Pay (contexte support Tawk — best-effort).
  const partner = await getCurrentPartner();
  return (
    <div className="bg-surface-2 min-h-screen">
      {/* Contexte support : rôle « Agent Coligo Pay » + identité. */}
      <TawkChat
        role="agent"
        name={partner?.displayName ?? null}
        phone={partner?.phone ?? null}
        attributes={{
          "ID agent": partner?.ownerId,
          Wallet: partner?.walletId,
          Statut: partner?.status,
          Vérifié: partner?.isVerified,
        }}
      />
      {children}
    </div>
  );
}
