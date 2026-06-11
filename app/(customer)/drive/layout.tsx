import { Plus_Jakarta_Sans, Sora } from "next/font/google";

// Polices de la maquette Drive (Sora pour les titres/prix, Jakarta pour le corps).
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

export default function DriveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${sora.variable} ${jakarta.variable} drive-jakarta`}>
      {children}
    </div>
  );
}
