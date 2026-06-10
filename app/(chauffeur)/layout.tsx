export const dynamic = "force-dynamic";

/**
 * Espace CHAUFFEUR VTC (population séparée des livreurs). L'isolation de session
 * (confinement à /chauffeur) est gérée par le middleware via le domaine e-mail
 * `@chauffeurs.coligo.local`.
 */
export default function ChauffeurLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="bg-surface-2 min-h-screen">{children}</div>;
}
