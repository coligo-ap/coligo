import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Smartphone } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { StoreBadges } from "@/components/shared/store-badges";
import { StoreAutoRedirect } from "@/components/shared/store-auto-redirect";
import { APP_CONFIG } from "@/lib/config/app-config";
import {
  detectPlatformFromUA,
  forcedPlatform,
  storeUrlFor,
} from "@/lib/config/app-stores";

// L'en-tête User-Agent varie par visiteur : jamais de mise en cache statique.
export const dynamic = "force-dynamic";

export const metadata = {
  title: `Télécharger l'application — ${APP_CONFIG.name}`,
  description:
    "Installez Coligo sur iPhone ou Android : commandes, livraison, Drive et Coligo Pay dans une seule application.",
  alternates: { canonical: "/app" },
};

/**
 * LIEN INTELLIGENT D'INSTALLATION — `coligo.app/app`.
 *
 * (`/telecharger` est déjà pris par la page APK commerçant : on garde une
 * adresse courte, facile à dicter, à imprimer en QR ou à envoyer par SMS.)
 *
 * Un seul lien à partager (SMS, QR imprimé, réseaux, e-mail, affiche) :
 *   - sur iPhone/iPad → App Store,
 *   - sur Android → Google Play,
 *   - sur ordinateur → cette page, avec les deux boutons.
 *
 * La redirection est décidée SERVEUR d'après le User-Agent : elle part avant
 * le premier rendu, donc l'utilisateur ne voit aucune page intermédiaire. Le
 * navigateur ne sert qu'à rattraper le seul cas que le serveur ne peut pas
 * trancher : un iPad récent, qui se présente comme un Mac.
 *
 * `?p=ios|android` force une boutique (utile pour « voir la fiche » depuis un
 * ordinateur, ou pour une campagne ciblée).
 */
export default async function TelechargerPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; stay?: string }>;
}) {
  const sp = await searchParams;
  const forced = forcedPlatform(sp.p);
  const ua = (await headers()).get("user-agent");
  const platform = forced ?? detectPlatformFromUA(ua);

  // `?stay=1` : rester sur la page (utile pour la relire depuis un mobile).
  if (!sp.stay) {
    const target = storeUrlFor(platform);
    if (target) redirect(target);
  }

  const locale = await getLocale();
  const t = await getTranslations("download");
  const isAr = locale === "ar";

  return (
    <main
      dir={isAr ? "rtl" : "ltr"}
      className="bg-surface-2 flex min-h-dvh flex-col items-center justify-center px-5 py-[calc(env(safe-area-inset-top)+2rem)]"
    >
      {/* Rattrapage navigateur : iPad annoncé comme Mac (et tout appareil que
          l'en-tête n'aurait pas identifié). Sans effet sur un vrai ordinateur. */}
      {!sp.stay && <StoreAutoRedirect />}

      <div className="bg-surface rounded-panel w-full max-w-md p-7 text-center shadow-[0_20px_50px_-24px_rgba(40,35,90,.35)]">
        <div className="flex justify-center">
          <Logo size="lg" />
        </div>
        <h1 className="text-foreground mt-5 text-2xl font-extrabold">
          {t("title")}
        </h1>
        <p className="text-muted mt-2 text-sm font-medium">{t("subtitle")}</p>

        <StoreBadges className="mt-6 justify-center" />

        <p className="text-subtle text-label mt-6 flex items-center justify-center gap-1.5 font-semibold">
          <Smartphone className="size-3.5 shrink-0" />
          {t("hint")}
        </p>
      </div>

      <Link
        href="/"
        className="text-muted hover:text-foreground mt-5 text-sm font-bold transition-colors"
      >
        {t("continueWeb")}
      </Link>
    </main>
  );
}
