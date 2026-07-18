import type { Metadata } from "next";

// SEO : page d'inscription = jamais indexée (cf. se-connecter/layout.tsx).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: "/inscription" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
