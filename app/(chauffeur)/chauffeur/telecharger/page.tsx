import { getLocale } from "next-intl/server";
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

const BENEFITS_AR: DownloadBenefit[] = [
  {
    icon: Bell,
    title: "طلبات جديدة",
    text: "يصلك تنبيه بالمشوار حتى والتطبيق في الخلفية — صوت وإشعار، دون إبقاء أي تبويب مفتوحًا.",
  },
  {
    icon: Navigation,
    title: "تحديد موقع موثوق",
    text: "الموقع والتتبّع في الخلفية من أجل الراكب، أكثر استقرارًا بكثير من المتصفح.",
  },
  {
    icon: Maximize2,
    title: "شاشة كاملة",
    text: "واجهة مخصّصة، بلا شريط عنوان ولا تبويبات — مصمّمة للقيادة.",
  },
  {
    icon: Zap,
    title: "أسرع",
    text: "تشغيل فوري من الأيقونة، وتنقّل أكثر سلاسة من المتصفح.",
  },
];

export default async function ChauffeurTelechargerPage() {
  const { url, version, size } = APP_CONFIG.driveApk;
  const isAr = (await getLocale()) === "ar";
  return (
    <AppDownloadPage
      appName="Coligo Drive"
      tagline={
        isAr
          ? "تطبيق السائق لاستقبال المشاوير والتفاوض ومتابعة الأرباح."
          : "L’application chauffeur pour recevoir vos courses, négocier et suivre vos gains."
      }
      iconSrc="/icons/drive-512.png"
      apkHref="/api/app-download/drive"
      fileName="coligo-drive.apk"
      url={url}
      version={version}
      size={size}
      benefits={isAr ? BENEFITS_AR : BENEFITS}
      backHref="/chauffeur"
    />
  );
}
