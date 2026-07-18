import type { Metadata } from "next";

// SEO : page de connexion = JAMAIS indexée (Search Console remontait des
// doublons /se-connecter?next=… sans canonique). noindex + canonique SANS
// paramètres ; la route reste crawlable (robots.txt ne la bloque pas) pour
// que Google LISE ce noindex et retire les variantes de l'index.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: "/se-connecter" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
