import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_CONFIG } from "@/lib/config/app-config";
import { LEGAL } from "@/lib/config/legal";
import { getFeatureFlags, isVisible } from "@/lib/data/feature-flags";

export const metadata = { title: "Mentions légales" };

export default async function MentionsLegalesPage() {
  const flags = await getFeatureFlags();
  const drive = isVisible(flags.drive);
  const pay = isVisible(flags.coligo_pay);
  const delivery = isVisible(flags.express) || isVisible(flags.tour);

  const activityParts = [
    "la commande de produits",
    ...(delivery ? ["la livraison"] : []),
    ...(drive ? ["le transport de personnes (Coligo Drive)"] : []),
    ...(pay ? ["les services de solde prépayé associés (Coligo Pay)"] : []),
  ];
  const activity =
    activityParts.length > 1
      ? `${activityParts.slice(0, -1).join(", ")} et ${activityParts.at(-1)}`
      : activityParts[0];

  const partnerKinds = [
    "commerçants",
    ...(delivery ? ["livreurs"] : []),
    ...(drive ? ["chauffeurs"] : []),
  ].join(", ");

  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>

        <h1 className="text-foreground text-2xl font-bold">Mentions légales</h1>
        <p className="text-muted mt-1 text-sm">
          Informations publiées conformément à la loi n° 18-05 du 10 mai 2018
          relative au commerce électronique.
        </p>

        <div className="text-foreground mt-6 space-y-6 text-sm leading-relaxed">
          <Section title="Éditeur et exploitant">
            <ul className="space-y-1">
              <li>
                <strong>Plateforme :</strong> {LEGAL.platform} — {LEGAL.site} et
                applications mobiles associées.
              </li>
              <li>
                <strong>Exploitant :</strong> M. {LEGAL.ownerFullName}.
              </li>
              <li>
                <strong>Statut :</strong> {LEGAL.status} ({LEGAL.statusLaw}).
              </li>
              <li>
                <strong>Immatriculation :</strong> {LEGAL.registrationLabel}, n°{" "}
                {LEGAL.registrationNumber}.
              </li>
              <li>
                <strong>Adresse :</strong> {LEGAL.address}.
              </li>
              <li>
                <strong>Contact :</strong>{" "}
                <a
                  href={`mailto:${APP_CONFIG.contact.contactEmail}`}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {APP_CONFIG.contact.contactEmail}
                </a>{" "}
                ·{" "}
                <a
                  href={`mailto:${APP_CONFIG.contact.supportEmail}`}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {APP_CONFIG.contact.supportEmail}
                </a>
              </li>
            </ul>
          </Section>

          <Section title="Hébergement">
            <ul className="space-y-1">
              <li>
                <strong>Site et application :</strong> {LEGAL.hosting.web}.
              </li>
              <li>
                <strong>Données :</strong> {LEGAL.hosting.data}.
              </li>
            </ul>
          </Section>

          <Section title="Activité">
            <p>
              {LEGAL.platform} est une plateforme d&apos;intermédiation en ligne
              mettant en relation les clients et des partenaires indépendants (
              {partnerKinds}) pour {activity}. Les conditions d&apos;utilisation
              détaillées figurent dans les{" "}
              <Link
                href="/cgu"
                className="text-primary-700 font-medium hover:underline"
              >
                Conditions générales d&apos;utilisation
              </Link>{" "}
              et le traitement des données personnelles dans la{" "}
              <Link
                href="/confidentialite"
                className="text-primary-700 font-medium hover:underline"
              >
                Politique de confidentialité
              </Link>
              .
            </p>
          </Section>

          <Section title="Propriété intellectuelle">
            <p>
              La marque {LEGAL.platform}, les logos, textes, interfaces et bases
              de données de la Plateforme sont protégés par les ordonnances n°
              03-05 (droits d&apos;auteur et droits voisins) et n° 03-06
              (marques) du 19 juillet 2003. Toute reproduction, extraction ou
              exploitation non autorisée est interdite et expose son auteur à
              des poursuites.
            </p>
          </Section>

          <Section title="Signalement">
            <p>
              Pour signaler un contenu illicite, une fraude ou un abus :{" "}
              <a
                href={`mailto:${APP_CONFIG.contact.supportEmail}`}
                className="text-primary-700 font-medium hover:underline"
              >
                {APP_CONFIG.contact.supportEmail}
              </a>{" "}
              ou via la page{" "}
              <Link
                href="/contact"
                className="text-primary-700 font-medium hover:underline"
              >
                Nous contacter
              </Link>
              .
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-foreground mb-1.5 text-base font-semibold">
        {title}
      </h2>
      <div className="text-muted space-y-2">{children}</div>
    </section>
  );
}
