import Image from "next/image";
import Link from "next/link";
import { useLocale } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ApkDownloadButton } from "@/components/merchant/apk-download-button";

export type DownloadBenefit = { icon: LucideIcon; title: string; text: string };

const STEPS = [
  {
    n: 1,
    title: "Télécharger le fichier",
    titleAr: "تحميل الملف",
    text: "Touchez le bouton ci-dessus. Le fichier .apk se télécharge sur votre appareil.",
    textAr: "المس الزر أعلاه. سيُحمَّل ملف ‎.apk على جهازك.",
  },
  {
    n: 2,
    title: "Autoriser l’installation",
    titleAr: "السماح بالتثبيت",
    text: "Android peut demander d’autoriser « les sources inconnues » ou « cette source » — acceptez pour ce téléchargement.",
    textAr:
      "قد يطلب أندرويد السماح بـ«المصادر المجهولة» أو «هذا المصدر» — اقبل لهذا التحميل.",
  },
  {
    n: 3,
    title: "Ouvrir le fichier téléchargé",
    titleAr: "فتح الملف المحمَّل",
    text: "Dans la notification de téléchargement ou le dossier « Téléchargements », touchez le fichier .apk.",
    textAr: "من إشعار التحميل أو مجلد «التنزيلات»، المس ملف ‎.apk.",
  },
  {
    n: 4,
    title: "Installer puis ouvrir",
    titleAr: "التثبيت ثم الفتح",
    text: "Touchez « Installer », puis « Ouvrir ». Connectez-vous avec vos identifiants habituels.",
    textAr: "المس «تثبيت» ثم «فتح». سجّل الدخول ببياناتك المعتادة.",
  },
];

/**
 * Page de téléchargement d'une application Android Coligo (commerçant, livreur,
 * chauffeur Drive). Hero + bouton + avantages + étapes d'installation. Le lien
 * passe par une route même-origine (`apkHref`) qui force le téléchargement.
 */
export function AppDownloadPage({
  appName,
  tagline,
  iconSrc,
  apkHref,
  fileName,
  url,
  version,
  size,
  benefits,
  backHref,
}: {
  appName: string;
  tagline: string;
  iconSrc: string;
  apkHref: string;
  fileName: string;
  url: string;
  version?: string;
  size?: string;
  benefits: DownloadBenefit[];
  /** Lien de retour (espaces sans coque, ex. livreur/chauffeur). */
  backHref?: string;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <div className="mx-auto max-w-[820px] p-4 lg:p-6 lg:px-8">
      {backHref && (
        <Link
          href={backHref}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {tr("Retour", "رجوع")}
        </Link>
      )}
      {/* Hero */}
      <section className="cg-brand-gradient relative overflow-hidden rounded-xl px-6 py-8 text-white shadow-lg lg:px-10 lg:py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-white/10 blur-2xl"
        />
        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:gap-6 sm:text-start">
          <span className="rounded-sheet-xl flex size-20 shrink-0 items-center justify-center bg-white/15 p-2 shadow-inner ring-1 ring-white/20 backdrop-blur">
            <Image
              src={iconSrc}
              alt={appName}
              width={72}
              height={72}
              className="rounded-lg"
            />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wider text-white/70 uppercase">
              {tr("Application Android", "تطبيق أندرويد")}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">
              {appName}
            </h1>
            <p className="mt-1.5 text-sm text-white/85">{tagline}</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <div className="mt-5">
        <ApkDownloadButton
          url={url}
          version={version}
          size={size}
          apkHref={apkHref}
          fileName={fileName}
        />
        <p className="text-muted mt-2 text-center text-xs">
          {tr(
            "Fichier .apk officiel Coligo · Android uniquement",
            "ملف ‎.apk رسمي من كوليغو · أندرويد فقط"
          )}
          {version ? ` · ${tr("version", "الإصدار")} ${version}` : ""}
          {url && (
            <>
              {" · "}
              <a
                href={apkHref}
                className="text-primary-600 underline underline-offset-2"
              >
                {tr("Le téléchargement ne démarre pas ?", "التحميل لا يبدأ؟")}
              </a>
            </>
          )}
        </p>
      </div>

      {/* Avantages */}
      <section className="mt-8">
        <h2 className="text-foreground text-lg font-semibold">
          {tr("Pourquoi installer l’application ?", "لماذا تثبيت التطبيق؟")}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {benefits.map((b) => {
            const Icon = b.icon;
            return (
              <div
                key={b.title}
                className="border-border rounded-lg border bg-white p-4"
              >
                <span className="bg-primary-50 text-primary-600 flex size-10 items-center justify-center rounded-full">
                  <Icon className="size-5" />
                </span>
                <h3 className="text-foreground mt-3 text-sm font-semibold">
                  {b.title}
                </h3>
                <p className="text-muted mt-1 text-sm leading-relaxed">
                  {b.text}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Étapes */}
      <section className="mt-8">
        <h2 className="text-foreground text-lg font-semibold">
          {tr("Comment l’installer ?", "كيف يُثبَّت؟")}
        </h2>
        <ol className="border-border divide-border mt-3 divide-y overflow-hidden rounded-lg border bg-white">
          {STEPS.map((s) => (
            <li key={s.n} className="flex items-start gap-4 p-4">
              <span className="bg-primary-600 flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">
                {s.n}
              </span>
              <div className="min-w-0">
                <h3 className="text-foreground text-sm font-semibold">
                  {isAr ? s.titleAr : s.title}
                </h3>
                <p className="text-muted mt-0.5 text-sm leading-relaxed">
                  {isAr ? s.textAr : s.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Note sécurité */}
      <div className="border-border bg-surface-2 rounded-card-lg mt-6 flex items-start gap-3 border p-4">
        <ShieldCheck className="text-primary-600 size-5 shrink-0" />
        <p className="text-muted text-xs leading-relaxed">
          {tr(
            "L’avertissement Android « source inconnue » est normal pour une application distribuée hors du Play Store. Le fichier provient uniquement de Coligo.",
            "تحذير أندرويد «مصدر مجهول» أمر طبيعي لتطبيق يوزَّع خارج متجر Play. الملف يأتي من كوليغو حصريًا."
          )}
        </p>
      </div>
    </div>
  );
}
