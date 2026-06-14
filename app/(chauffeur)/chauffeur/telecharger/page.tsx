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
    title: "Nouvelles demandes",
    text: "Soyez prévenu d’une course même app en arrière-plan — son et notification, sans garder un onglet ouvert.",
  },
  {
    icon: Navigation,
    title: "Géolocalisation fiable",
    text: "Position et suivi en arrière-plan pour le passager, bien plus stable qu’en navigateur.",
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

export default function ChauffeurTelechargerPage() {
  const { url, version, size } = APP_CONFIG.driveApk;
  return (
    <AppDownloadPage
      appName="Coligo Drive"
      tagline="L’application chauffeur pour recevoir vos courses, négocier et suivre vos gains."
      iconSrc="/icons/drive-512.png"
      apkHref="/api/app-download/drive"
      fileName="coligo-drive.apk"
      url={url}
      version={version}
      size={size}
      benefits={BENEFITS}
      backHref="/chauffeur"
    />
  );
}
