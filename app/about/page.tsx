import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { StoreBadges } from "@/components/shared/store-badges";
import {
  ArrowLeft,
  ArrowRight,
  Bike,
  Car,
  Clock3,
  HandCoins,
  Heart,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import { BRAND_ASSETS } from "@/lib/config/brand-assets";
import { APP_CONFIG } from "@/lib/config/app-config";
import { LEGAL } from "@/lib/config/legal";
import { getFeatureFlags, isVisible } from "@/lib/data/feature-flags";
import { cldUrl } from "@/lib/images/cloudinary";
import { CATEGORY_IMAGES } from "@/lib/images/category-images";

export const metadata = {
  title: "À propos de Coligo — le commerce de proximité, en mieux",
  description:
    "Coligo connecte les Algériens à leurs commerces de quartier : commande à l'avance, retrait sans attente, livraison express et paiement simple. Découvrez notre mission.",
};

// =============================================================================
// /about — page « À propos » du footer marketplace. Vitrine institutionnelle :
// mission, comment ça marche, services (adaptés aux feature flags comme les
// CGU : un service masqué n'apparaît pas), valeurs, partenaires, CTA. Photos
// haute résolution servies via Cloudinary Fetch (w explicite = jamais floues,
// jamais surdimensionnées).
// =============================================================================

/** Bandeau photo : 3 visuels de commerces (mêmes sources HD que la
 *  marketplace) recadrés par Cloudinary au ratio d'affichage — pas de zoom
 *  navigateur, pas de perte. */
const STRIP = [
  { key: "superette", alt: "Supérette de quartier" },
  { key: "boulangerie", alt: "Boulangerie artisanale" },
  { key: "cafe", alt: "Café" },
] as const;

export default async function AboutPage() {
  // Server Component : `getTranslations` (jamais `useTranslations`, qui est
  // réservé aux composants client — piège connu du projet).
  const tDl = await getTranslations("download");
  const flags = await getFeatureFlags();
  const drive = isVisible(flags.drive);
  const pay = isVisible(flags.coligo_pay);
  const delivery = isVisible(flags.express) || isVisible(flags.tour);

  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>

        {/* ───── HERO — dégradé de marque, promesse claire ───── */}
        <section className="cg-brand-gradient relative overflow-hidden rounded-[24px] p-7 text-white lg:p-10">
          <div className="relative z-[1]">
            <Image
              src={BRAND_ASSETS.fullWhite}
              alt={APP_CONFIG.name}
              width={1000}
              height={401}
              className="h-8 w-auto"
              priority
            />
            <h1 className="mt-5 max-w-xl text-3xl leading-tight font-black tracking-tight text-balance lg:text-4xl">
              Le commerce de proximité, sans l&apos;attente.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/85 lg:text-base">
              {APP_CONFIG.name} connecte les Algériens à leurs commerces de
              quartier : vous commandez à l&apos;avance, votre commerçant
              prépare, vous récupérez sans faire la queue
              {delivery ? " — ou vous êtes livré en express" : ""}. Simple,
              local, fiable.
            </p>
          </div>
          {/* Halo décoratif */}
          <div
            aria-hidden
            className="absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl"
          />
        </section>

        {/* ───── BANDEAU PHOTOS — vrais commerces, vraies couleurs ───── */}
        <div className="mt-4 grid grid-cols-3 gap-2 lg:gap-3">
          {STRIP.map((s) => {
            const src = CATEGORY_IMAGES[s.key];
            const url =
              cldUrl(src, {
                width: 640,
                height: 480,
                crop: "fill",
                gravity: "auto",
              }) ?? src;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={s.key}
                src={url}
                alt={s.alt}
                loading="lazy"
                decoding="async"
                className="aspect-[4/3] w-full rounded-[16px] object-cover"
              />
            );
          })}
        </div>

        {/* ───── MISSION ───── */}
        <section className="mt-8">
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Notre mission
          </h2>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            Les supérettes, boulangeries, boucheries et restaurants de quartier
            sont le cœur battant de nos villes. {APP_CONFIG.name} leur donne les
            mêmes armes numériques que les grandes enseignes — vitrine en ligne,
            commande à l&apos;avance, encaissement moderne — sans rien changer à
            ce qui fait leur force : la proximité et la confiance. Côté client,
            fini la file d&apos;attente et les déplacements pour rien : votre
            commande vous attend, prête à l&apos;heure dite.
          </p>
        </section>

        {/* ───── COMMENT ÇA MARCHE ───── */}
        <section className="mt-8">
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Comment ça marche
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Step
              n={1}
              icon={<MapPin className="size-5" />}
              title="Trouvez vos commerces"
              text="Autour de vous, triés par proximité : supérettes, boulangeries, restaurants, pharmacies et bien plus."
            />
            <Step
              n={2}
              icon={<ShoppingBag className="size-5" />}
              title="Commandez à l'avance"
              text="Choisissez vos produits et votre créneau. Le commerçant reçoit la commande instantanément et prépare."
            />
            <Step
              n={3}
              icon={<Clock3 className="size-5" />}
              title="Zéro attente"
              text={
                delivery
                  ? "Retirez en boutique sans faire la queue, ou faites-vous livrer en express par un livreur partenaire."
                  : "Passez récupérer à l'heure choisie : votre commande est prête, sans file d'attente."
              }
            />
            <Step
              n={4}
              icon={<HandCoins className="size-5" />}
              title="Payez comme vous voulez"
              text={
                pay
                  ? "En espèces, avec votre solde Coligo Pay ou en ligne — le détail des montants est toujours affiché avant de valider."
                  : "En espèces ou en ligne — le détail des montants est toujours affiché avant de valider."
              }
            />
          </div>
        </section>

        {/* ───── NOS SERVICES ───── */}
        <section className="mt-8">
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Nos services
          </h2>
          <div className="mt-4 space-y-3">
            <Service
              icon={<ShoppingBag className="text-primary-600 size-5" />}
              title="Coligo Marketplace"
              text="La vitrine en ligne de vos commerces de quartier : catalogue à jour, promotions réelles, avis clients et commande en quelques gestes."
            />
            {delivery && (
              <Service
                icon={<Bike className="text-primary-600 size-5" />}
                title="Livraison express"
                text="Des livreurs partenaires indépendants livrent vos commandes en direct, avec suivi en temps réel du départ jusqu'à votre porte."
              />
            )}
            {drive && (
              <Service
                icon={<Car className="text-primary-600 size-5" />}
                title="Coligo Drive"
                text="Le transport de personnes, au prix annoncé avant de confirmer : des chauffeurs partenaires vérifiés, un suivi de course en direct."
              />
            )}
            {pay && (
              <Service
                icon={<Wallet className="text-primary-600 size-5" />}
                title="Coligo Pay"
                text={
                  flags.coligo_pay_agents.status === "active"
                    ? "Un solde prépayé rechargeable auprès d'agents agréés près de chez vous : payez vos commandes en un geste, sans monnaie et sans carte."
                    : "Un solde prépayé rechargeable depuis l'application : payez vos commandes en un geste, sans monnaie et sans carte."
                }
              />
            )}
          </div>
        </section>

        {/* ───── VALEURS ───── */}
        <section className="mt-8">
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Ce qui nous guide
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Value
              icon={<Heart className="size-5" />}
              title="Proximité"
              text="On fait grandir le commerce d'à côté, pas l'inverse."
            />
            <Value
              icon={<ShieldCheck className="size-5" />}
              title="Confiance"
              text="Partenaires vérifiés, avis authentiques, paiements traçables."
            />
            <Value
              icon={<Sparkles className="size-5" />}
              title="Simplicité"
              text="Chaque écran est pensé pour aller à l'essentiel, en français et en arabe."
            />
          </div>
        </section>

        {/* ───── PARTENAIRES / CTA ───── */}
        <section className="border-border bg-surface mt-8 rounded-[20px] border p-6">
          <div className="flex items-start gap-3">
            <span className="bg-primary-50 text-primary-600 grid size-11 shrink-0 place-items-center rounded-2xl">
              <Store className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-foreground text-lg font-bold">
                Commerçant, livreur{drive ? ", chauffeur" : ""} ? Rejoignez le
                mouvement.
              </h2>
              <p className="text-muted mt-1 text-sm leading-relaxed">
                Des milliers de clients cherchent déjà leurs commerces sur{" "}
                {APP_CONFIG.name}. L&apos;inscription est gratuite et
                l&apos;équipe vous accompagne à chaque étape.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/login"
                  className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white transition-colors"
                >
                  Devenir partenaire
                  <ArrowRight className="size-4 rtl:-scale-x-100" />
                </Link>
                <Link
                  href="/contact"
                  className="border-border text-foreground hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
                >
                  Nous contacter
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ───── PIED : identité + liens légaux ───── */}
        <p className="text-subtle mt-8 text-xs leading-relaxed">
          {LEGAL.platform} est une plateforme algérienne exploitée par M.{" "}
          {LEGAL.ownerFullName}, immatriculée au {LEGAL.registrationLabel} sous
          le n° {LEGAL.registrationNumber}. Voir les{" "}
          <Link
            href="/mentions-legales"
            className="text-primary-700 font-medium hover:underline"
          >
            mentions légales
          </Link>
          , les{" "}
          <Link
            href="/cgu"
            className="text-primary-700 font-medium hover:underline"
          >
            CGU
          </Link>{" "}
          et la{" "}
          <Link
            href="/confidentialite"
            className="text-primary-700 font-medium hover:underline"
          >
            politique de confidentialité
          </Link>
          .
        </p>

        {/* Installation — badges OFFICIELS des deux boutiques, chacun avec son
            lien direct. Page publique très consultée depuis un téléphone : le
            pied de page (réservé à l'ordinateur) ne suffisait pas. */}
        <section className="border-border bg-surface mt-8 rounded-[20px] border p-6 text-center">
          <h2 className="text-foreground text-lg font-extrabold">
            {tDl("title")}
          </h2>
          <p className="text-muted mx-auto mt-1.5 max-w-md text-sm">
            {tDl("subtitle")}
          </p>
          <StoreBadges className="mt-5 justify-center" />
        </section>
      </div>
    </main>
  );
}

/** Étape numérotée du « comment ça marche ». */
function Step({
  n,
  icon,
  title,
  text,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="border-border bg-surface rounded-[16px] border p-5">
      <div className="flex items-center gap-2.5">
        <span className="bg-primary-600 grid size-8 shrink-0 place-items-center rounded-full text-sm font-black text-white">
          {n}
        </span>
        <span className="text-primary-600">{icon}</span>
        <h3 className="text-foreground text-[15px] font-bold">{title}</h3>
      </div>
      <p className="text-muted mt-2 text-sm leading-relaxed">{text}</p>
    </div>
  );
}

/** Ligne service (icône + titre + description). */
function Service({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="border-border bg-surface flex items-start gap-3 rounded-[16px] border p-5">
      <span className="bg-primary-50 grid size-10 shrink-0 place-items-center rounded-xl">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-foreground text-[15px] font-bold">{title}</h3>
        <p className="text-muted mt-1 text-sm leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

/** Carte valeur (compacte, centrée). */
function Value({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="border-border bg-surface rounded-[16px] border p-5 text-center">
      <span className="bg-primary-50 text-primary-600 mx-auto grid size-10 place-items-center rounded-xl">
        {icon}
      </span>
      <h3 className="text-foreground mt-2.5 text-[15px] font-bold">{title}</h3>
      <p className="text-muted mt-1 text-[13px] leading-relaxed">{text}</p>
    </div>
  );
}
