import type { ReactNode } from "react";

// Espace point de recharge partenaire — confiné à /partenaire par le middleware
// (isolation des rôles, email @partners.coligo.local).
export default function PartnerLayout({ children }: { children: ReactNode }) {
  return <div className="bg-surface-2 min-h-screen">{children}</div>;
}
