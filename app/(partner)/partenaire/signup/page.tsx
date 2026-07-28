import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerSignupForm } from "@/components/partner/signup-form";
import { AuthScreen } from "@/components/shared/auth-screen";
import { AuthModeTabs } from "@/components/shared/auth-mode-tabs";

export const dynamic = "force-dynamic";

const HERO_IMG =
  "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1400&q=80";

export default async function PartnerSignupPage() {
  // Déjà connecté en agent ? → direct à l'espace.
  const partner = await getCurrentPartner();
  if (partner) redirect("/partenaire");

  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  return (
    <AuthScreen
      navVariant="partner"
      installLabel={tr("Installer l'application Agent", "ثبّت تطبيق الوكيل")}
      hero={{
        title: isAr ? (
          <>
            كن وكيل <br />
            كوليغو باي.
          </>
        ) : (
          <>
            Devenez Agent <br />
            Coligo Pay.
          </>
        ),
        subtitle: tr(
          "Rejoignez le réseau des points de recharge Coligo et vendez du crédit.",
          "انضم إلى شبكة نقاط تعبئة كوليغو وبِع الرصيد."
        ),
        features: isAr
          ? [
              "بِع الرصيد لزبائنك",
              "اربح على كل تعبئة",
              "اظهر على خريطة النقاط",
              "ملف يُراجَع من طرف كوليغو",
            ]
          : [
              "Vendez du crédit à vos clients",
              "Gagnez sur chaque recharge",
              "Apparaissez sur la carte des points",
              "Un dossier validé par Coligo",
            ],
        imageUrl: HERO_IMG,
      }}
      cardTitle={tr("Demande de partenariat", "طلب شراكة")}
      cardSubtitle={tr(
        "Votre point de recharge. Dossier examiné avant activation.",
        "نقطة التعبئة الخاصة بك. يُراجَع الملف قبل التفعيل."
      )}
      modeTabs={
        <AuthModeTabs
          mode="signup"
          loginHref="/partenaire/login"
          signupHref="/partenaire/signup"
        />
      }
    >
      <PartnerSignupForm />
    </AuthScreen>
  );
}
