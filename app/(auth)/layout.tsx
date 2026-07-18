import type { Metadata } from "next";

// SEO : les écrans d'auth des espaces pro (/login, /signup) ne sont jamais
// indexés — noindex lisible par Google (non bloqués dans robots.txt).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
