import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_CONFIG } from "@/lib/config/app-config";

export const metadata = { title: "Politique de confidentialité" };

export default function ConfidentialitePage() {
  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>

        <h1 className="text-foreground text-2xl font-bold">
          Politique de confidentialité
        </h1>
        <p className="text-muted mt-1 text-sm">
          Dernière mise à jour : juin 2026
        </p>

        <div className="text-foreground mt-6 space-y-5 text-sm leading-relaxed">
          <Section title="1. Données collectées">
            {APP_CONFIG.name} collecte les informations nécessaires au
            fonctionnement du service : identité, coordonnées, position
            géographique (avec votre autorisation), historique de commandes et
            de paiements, et données techniques d&apos;appareil.
          </Section>
          <Section title="2. Utilisation des données">
            Vos données servent à fournir le service (mise en relation,
            livraison, transport, paiement), assurer la sécurité, prévenir la
            fraude, et améliorer la plateforme. Elles ne sont jamais vendues à
            des tiers.
          </Section>
          <Section title="3. Géolocalisation">
            La position n&apos;est utilisée que lorsque vous l&apos;autorisez,
            pour afficher les commerces, points de recharge et trajets à
            proximité, ainsi que pour le suivi des livraisons et courses en
            cours.
          </Section>
          <Section title="4. Partage">
            Certaines données sont partagées avec les parties impliquées dans
            une transaction (commerçant, livreur, chauffeur) et avec les
            prestataires de paiement agréés, strictement dans la mesure
            nécessaire.
          </Section>
          <Section title="5. Conservation & sécurité">
            Les données sont conservées le temps nécessaire aux finalités
            décrites et protégées par des mesures techniques (chiffrement,
            contrôle d&apos;accès, registres inviolables).
          </Section>
          <Section title="6. Vos droits">
            Vous pouvez demander l&apos;accès, la rectification ou la
            suppression de vos données en nous contactant à{" "}
            <a
              href={`mailto:${APP_CONFIG.contact.supportEmail}`}
              className="text-primary-700 font-medium hover:underline"
            >
              {APP_CONFIG.contact.supportEmail}
            </a>
            .
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
      <h2 className="text-foreground mb-1 text-base font-semibold">{title}</h2>
      <p className="text-muted">{children}</p>
    </section>
  );
}
