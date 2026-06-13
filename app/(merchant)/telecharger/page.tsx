import Image from "next/image";
import { Bell, Maximize2, Printer, ShieldCheck, Zap } from "lucide-react";
import { ApkDownloadButton } from "@/components/merchant/apk-download-button";
import { APP_CONFIG } from "@/lib/config/app-config";

export const dynamic = "force-dynamic";

const BENEFITS = [
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

const STEPS = [
  {
    n: 1,
    title: "Télécharger le fichier",
    text: "Touchez le bouton ci-dessus. Le fichier .apk se télécharge sur votre appareil.",
  },
  {
    n: 2,
    title: "Autoriser l’installation",
    text: "Android peut demander d’autoriser « les sources inconnues » ou « cette source » — acceptez pour ce téléchargement.",
  },
  {
    n: 3,
    title: "Ouvrir le fichier téléchargé",
    text: "Dans la notification de téléchargement ou le dossier « Téléchargements », touchez le fichier Coligo.apk.",
  },
  {
    n: 4,
    title: "Installer puis ouvrir",
    text: "Touchez « Installer », puis « Ouvrir ». Connectez-vous avec vos identifiants commerçant habituels.",
  },
];

export default function TelechargerPage() {
  const { url, version, size } = APP_CONFIG.merchantApk;

  return (
    <div className="mx-auto max-w-[820px] p-4 lg:p-6 lg:px-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#5B2EFF] to-[#6C2BD9] px-6 py-8 text-white shadow-lg lg:px-10 lg:py-10">
        {/* halo décoratif */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-white/10 blur-2xl"
        />
        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:gap-6 sm:text-start">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-[22px] bg-white/15 p-2 shadow-inner ring-1 ring-white/20 backdrop-blur">
            <Image
              src="/icons/commercant-512.png"
              alt="Coligo Commerçant"
              width={72}
              height={72}
              className="rounded-[16px]"
            />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wider text-white/70 uppercase">
              Application Android
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">
              Coligo Commerçant
            </h1>
            <p className="mt-1.5 text-sm text-white/85">
              L’application de comptoir pour gérer vos commandes et{" "}
              <strong className="font-semibold text-white">
                imprimer vos tickets
              </strong>{" "}
              sur l’imprimante intégrée.
            </p>
          </div>
        </div>
      </section>

      {/* CTA téléchargement */}
      <div className="mt-5">
        <ApkDownloadButton url={url} version={version} size={size} />
        <p className="text-muted mt-2 text-center text-xs">
          Fichier .apk officiel Coligo · Android uniquement
          {version ? ` · version ${version}` : ""}
          {url && (
            <>
              {" · "}
              <a
                href="/telecharger/apk"
                className="text-primary-600 underline underline-offset-2"
              >
                Le téléchargement ne démarre pas ?
              </a>
            </>
          )}
        </p>
      </div>

      {/* Pourquoi l'installer */}
      <section className="mt-8">
        <h2 className="text-foreground text-lg font-semibold">
          Pourquoi installer l’application ?
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {BENEFITS.map((b) => {
            const Icon = b.icon;
            return (
              <div
                key={b.title}
                className="border-border rounded-[16px] border bg-white p-4"
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

      {/* Comment installer */}
      <section className="mt-8">
        <h2 className="text-foreground text-lg font-semibold">
          Comment l’installer ?
        </h2>
        <ol className="border-border divide-border mt-3 divide-y overflow-hidden rounded-[16px] border bg-white">
          {STEPS.map((s) => (
            <li key={s.n} className="flex items-start gap-4 p-4">
              <span className="bg-primary-600 flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">
                {s.n}
              </span>
              <div className="min-w-0">
                <h3 className="text-foreground text-sm font-semibold">
                  {s.title}
                </h3>
                <p className="text-muted mt-0.5 text-sm leading-relaxed">
                  {s.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Note sécurité */}
      <div className="border-border bg-surface-2 mt-6 flex items-start gap-3 rounded-[14px] border p-4">
        <ShieldCheck className="text-primary-600 size-5 shrink-0" />
        <p className="text-muted text-xs leading-relaxed">
          L’avertissement Android « source inconnue » est normal pour une
          application distribuée hors du Play Store. Le fichier provient
          uniquement de Coligo. En cas de doute, contactez le support depuis{" "}
          <span className="text-foreground font-medium">
            Aide &amp; support
          </span>
          .
        </p>
      </div>
    </div>
  );
}
