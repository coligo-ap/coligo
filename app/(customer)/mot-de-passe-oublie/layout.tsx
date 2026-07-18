import type { Metadata } from "next";

// SEO : récupération de mot de passe = jamais indexée.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: "/mot-de-passe-oublie" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
