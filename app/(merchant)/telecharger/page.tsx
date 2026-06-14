import { Bell, Maximize2, Printer, Zap } from "lucide-react";
import {
  AppDownloadPage,
  type DownloadBenefit,
} from "@/components/shared/app-download-page";
import { APP_CONFIG } from "@/lib/config/app-config";

export const dynamic = "force-dynamic";

const BENEFITS: DownloadBenefit[] = [
  {
    icon: Printer,
    title: "Impression thermique",
    text: "Imprime les tickets directement sur l’imprimante intégrée Sunmi. Indispensable : impossible depuis le navigateur ou « Ajouter à l’accueil ».",
  },
  {
    icon: Bell,
    title: "Notifications fiables",
    text: "Une nouvelle commande sonne et s’affiche même app en arrière-plan, sans garder un onglet ouvert.",
  },
  {
    icon: Maximize2,
    title: "Plein écran",
    text: "Interface dédiée, sans barre d’adresse ni onglets — pensée pour le comptoir.",
  },
  {
    icon: Zap,
    title: "Plus rapide",
    text: "Lancement instantané depuis l’icône, navigation plus fluide qu’en navigateur.",
  },
];

export default function TelechargerPage() {
  const { url, version, size } = APP_CONFIG.merchantApk;
  return (
    <AppDownloadPage
      appName="Coligo COMMERCE"
      tagline="L’application de comptoir pour gérer vos commandes et imprimer vos tickets sur l’imprimante intégrée."
      iconSrc="/icons/commercant-512.png"
      apkHref="/api/app-download/commerce"
      fileName="coligo-commercant.apk"
      url={url}
      version={version}
      size={size}
      benefits={BENEFITS}
    />
  );
}
