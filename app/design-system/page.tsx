import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { DesignSystemView } from "@/components/design-system/design-system-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design System — Coligo",
  // Page interne : jamais indexée, jamais partagée.
  robots: { index: false, follow: false },
};

/**
 * VITRINE DU DESIGN SYSTEM — le visuel EST la documentation.
 *
 * Accès réservé à l'équipe Coligo (même garde que /admin, MFA comprise) : la
 * page révèle l'inventaire complet de l'interface, elle n'a rien à faire
 * devant un client.
 *
 * Elle affiche la palette avec le NOM des tokens, la typographie, et chaque
 * primitive dans toutes ses variantes et tous ses états — en clair/sombre et
 * en LTR/RTL, sans quitter la page. Le nom du fichier source est écrit à côté
 * de chaque démo : voir un composant, c'est savoir où il vit.
 */
export default async function DesignSystemPage() {
  await requireSuperAdmin();
  return <DesignSystemView />;
}
