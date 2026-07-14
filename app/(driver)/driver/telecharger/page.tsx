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

const BENEFITS_AR: DownloadBenefit[] = [
  {
    icon: Bell,
    title: "توصيلات جديدة",
    text: "يصلك تنبيه بطلبية للتوصيل حتى والتطبيق في الخلفية — صوت وإشعار، دون إبقاء أي تبويب مفتوحًا.",
  },
  {
    icon: Navigation,
    title: "تحديد موقع موثوق",
    text: "الموقع والتتبّع في الخلفية من أجل الزبون والتاجر، أكثر استقرارًا بكثير من المتصفح.",
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

export default async function DriverTelechargerPage() {
  const { url, version, size } = APP_CONFIG.driverApk;
  const isAr = (await getLocale()) === "ar";
  return (
    <AppDownloadPage
      appName="Coligo Livreur"
      tagline={
        isAr
          ? "التطبيق لاستقبال التوصيلات ومتابعة تسليماتك والحصول على مستحقاتك."
          : "L’application pour recevoir vos courses, suivre vos livraisons et être payé."
      }
      iconSrc="/icons/livreur-512.png"
      apkHref="/api/app-download/driver"
      fileName="coligo-livreur.apk"
      url={url}
      version={version}
      size={size}
      benefits={isAr ? BENEFITS_AR : BENEFITS}
      backHref="/driver/parametres"
    />
  );
}
