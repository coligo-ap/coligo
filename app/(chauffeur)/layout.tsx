import { Plus_Jakarta_Sans, Sora } from "next/font/google";

export const dynamic = "force-dynamic";

// Polices de la maquette Drive (Sora titres/prix, Jakarta corps).
const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-sora",
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
});

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
  return (
    <div
      className={`${sora.variable} ${jakarta.variable} drive-jakarta min-h-screen bg-white`}
    >
      {children}
    </div>
  );
}
