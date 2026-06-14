import { Bell, Maximize2, Navigation, Zap } from "lucide-react";
import {
  AppDownloadPage,
  type DownloadBenefit,
} from "@/components/shared/app-download-page";
import { APP_CONFIG } from "@/lib/config/app-config";

export const dynamic = "force-dynamic";

const BENEFITS: DownloadBenefit[] = [
  {
    icon: Bell,
    title: "Nouvelles courses",
    text: "Soyez prévenu d’une commande à livrer même app en arrière-plan — son et notification, sans garder un onglet ouvert.",
  },
  {
    icon: Navigation,
    title: "Géolocalisation fiable",
    text: "Position et suivi en arrière-plan pour le client et le commerçant, bien plus stable qu’en navigateur.",
  },
  {
    icon: Maximize2,
    title: "Plein écran",
    text: "Interface dédiée, sans barre d’adresse ni onglets — pensée pour la conduite.",
  },
  {
    icon: Zap,
    title: "Plus rapide",
    text: "Lancement instantané depuis l’icône, navigation plus fluide qu’en navigateur.",
  },
];

export default function DriverTelechargerPage() {
  const { url, version, size } = APP_CONFIG.driverApk;
  return (
    <AppDownloadPage
      appName="Coligo Livreur"
      tagline="L’application pour recevoir vos courses, suivre vos livraisons et être payé."
      iconSrc="/icons/livreur-512.png"
      apkHref="/api/app-download/driver"
      fileName="coligo-livreur.apk"
      url={url}
      version={version}
      size={size}
      benefits={BENEFITS}
      backHref="/driver/parametres"
    />
  );
}
