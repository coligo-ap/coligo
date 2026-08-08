import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_CONFIG } from "@/lib/config/app-config";
import { LEGAL } from "@/lib/config/legal";
import { getFeatureFlags, isVisible } from "@/lib/data/feature-flags";

export const metadata = { title: "Politique de confidentialité" };

// Le document s'adapte aux services réellement proposés (voir /admin/controle) :
// un service masqué (« hidden ») disparaît des traitements décrits.
export default async function ConfidentialitePage() {
  const flags = await getFeatureFlags();
  const drive = isVisible(flags.drive);
  const pay = isVisible(flags.coligo_pay);
  const onlinePay = isVisible(flags.online_payment);
  const delivery = isVisible(flags.express) || isVisible(flags.tour);

  const partnerRoles = [
    "commerçants",
    ...(delivery ? ["livreurs"] : []),
    ...(drive ? ["chauffeurs"] : []),
    // Réseau d'agents Coligo Pay (kill-switch domaine, mig 0449).
    ...(pay && flags.coligo_pay_agents.status === "active" ? ["agents"] : []),
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

        <h1 className="text-foreground text-2xl font-bold">
          Politique de confidentialité
        </h1>
        <p className="text-muted mt-1 text-sm">
          Dernière mise à jour : {LEGAL.lastUpdate}
        </p>

        <div className="text-foreground mt-6 space-y-6 text-sm leading-relaxed">
          <Section title="1. Responsable du traitement">
            <p>
              Les données personnelles collectées via la plateforme{" "}
              {LEGAL.platform} sont traitées sous la responsabilité de M.{" "}
              {LEGAL.ownerFullName}, {LEGAL.status.toLowerCase()} immatriculé au{" "}
              {LEGAL.registrationLabel} sous le n°{" "}
              <strong>{LEGAL.registrationNumber}</strong>, {LEGAL.address}.
              Contact :{" "}
              <a
                href={`mailto:${APP_CONFIG.contact.supportEmail}`}
                className="text-primary-700 font-medium hover:underline"
              >
                {APP_CONFIG.contact.supportEmail}
              </a>
              .
            </p>
          </Section>

          <Section title="2. Cadre légal">
            <p>
              Les traitements sont réalisés conformément à la{" "}
              <strong>
                loi n° 18-07 du 10 juin 2018 relative à la protection des
                personnes physiques dans le traitement des données à caractère
                personnel
              </strong>
              , sous le contrôle de l&apos;Autorité nationale de protection des
              données à caractère personnel (ANPDP), ainsi qu&apos;à la loi n°
              18-05 du 10 mai 2018 relative au commerce électronique.
            </p>
          </Section>

          <Section title="3. Données collectées">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Identification et contact</strong> : nom, prénom, numéro
                de téléphone, adresse e-mail
                {delivery ? ", adresses de livraison" : ""}.
              </li>
              <li>
                <strong>Données de transaction</strong> : commandes
                {drive ? ", courses" : ""}, paiements
                {pay ? ", soldes et opérations Coligo Pay" : ""},
                remboursements, factures et relevés.
              </li>
              <li>
                <strong>Géolocalisation</strong> : position de l&apos;appareil,
                uniquement avec votre autorisation (voir l&apos;article «
                Géolocalisation »).
              </li>
              <li>
                <strong>Données techniques</strong> : modèle d&apos;appareil,
                système, identifiants de notification push, adresse IP, journaux
                de connexion et de sécurité.
              </li>
              <li>
                <strong>Partenaires ({partnerRoles})</strong> : documents
                professionnels requis pour la validation du compte
                (immatriculation, pièce d&apos;identité
                {delivery || drive
                  ? ", permis, assurance, documents du véhicule"
                  : ""}
                ), coordonnées de versement (CCP / RIB), notations et
                statistiques d&apos;activité.
              </li>
              <li>
                <strong>Échanges</strong> : messages du chat intégré
                {delivery ? " (client-livreur, support)" : " (support)"},
                réclamations et avis.
              </li>
            </ul>
          </Section>

          <Section title="4. Finalités et bases du traitement">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Exécution du service</strong> (base contractuelle) :
                création du compte, mise en relation, traitement des commandes
                {delivery ? ", livraisons" : ""}
                {drive ? " et courses" : ""}, paiements et versements,
                facturation, support et traitement des réclamations.
              </li>
              <li>
                <strong>Sécurité et prévention de la fraude</strong> (intérêt
                légitime) : vérification des comptes, plafonds, détection
                d&apos;usages anormaux, journalisation des appareils et adresses
                IP.
              </li>
              <li>
                <strong>Obligations légales</strong> : conservation des pièces
                comptables et fiscales, réponse aux réquisitions des autorités
                habilitées.
              </li>
              <li>
                <strong>Avec votre consentement</strong> : géolocalisation,
                notifications push, communications promotionnelles (retrait
                possible à tout moment).
              </li>
            </ul>
          </Section>

          <Section title="5. Géolocalisation">
            <p>
              La position n&apos;est utilisée que lorsque vous l&apos;autorisez
              via votre appareil : affichage des commerces
              {pay ? " et points de recharge" : ""} à proximité
              {delivery
                ? ", calcul des frais et délais de livraison, suivi en temps réel des livraisons"
                : ""}
              {drive ? (delivery ? " et courses" : ", suivi des courses") : ""}
              {delivery || drive
                ? ", et attribution des demandes aux partenaires proches. Les partenaires en service partagent leur position pendant leur activité pour permettre ce fonctionnement."
                : "."}{" "}
              Vous pouvez révoquer l&apos;autorisation à tout moment dans les
              réglages de votre appareil.
            </p>
          </Section>

          <Section title="6. Destinataires et partage">
            <p>
              Vos données ne sont <strong>jamais vendues</strong>. Elles ne sont
              partagées que dans la mesure strictement nécessaire :
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                avec les parties à votre transaction (le commerçant voit la
                commande
                {delivery
                  ? " ; le livreur voit le prénom, l'adresse de livraison et, sauf masquage, le téléphone"
                  : ""}
                {drive
                  ? " ; le chauffeur voit le prénom et le point de rendez-vous"
                  : ""}
                ) ;
              </li>
              <li>
                avec les prestataires techniques : hébergement (
                {LEGAL.hosting.web} ; {LEGAL.hosting.data})
                {onlinePay
                  ? ", prestataires de paiement agréés en Algérie pour les paiements par carte"
                  : ""}
                , services d&apos;envoi de notifications ;
              </li>
              <li>
                avec les autorités algériennes habilitées, sur réquisition
                légale.
              </li>
            </ul>
          </Section>

          <Section title="7. Hébergement et transferts">
            <p>
              Certaines données sont hébergées sur des infrastructures cloud
              situées en dehors de l&apos;Algérie, encadrées par des engagements
              contractuels de confidentialité et de sécurité conformes à
              l&apos;article 44 de la loi n° 18-07. En créant un compte, vous
              consentez à cet hébergement, nécessaire à la fourniture du
              service.
            </p>
          </Section>

          <Section title="8. Durées de conservation">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Données de compte : pendant la durée de vie du compte, puis
                anonymisation lors de sa suppression.
              </li>
              <li>
                Données de transaction et pièces comptables : durées légales
                applicables en matière commerciale et fiscale (jusqu&apos;à dix
                ans pour les livres et pièces comptables, article 12 du code de
                commerce).
              </li>
              <li>
                Journaux techniques et de sécurité : durée limitée,
                proportionnée aux finalités de sécurité.
              </li>
            </ul>
          </Section>

          <Section title="9. Sécurité">
            <p>
              {LEGAL.platform} met en œuvre des mesures techniques et
              organisationnelles adaptées : chiffrement des communications
              (TLS), contrôle d&apos;accès strict par rôle, cloisonnement des
              données entre utilisateurs, registres d&apos;opérations horodatés
              et infalsifiables, journalisation des accès, vérification des
              fichiers téléversés et surveillance d&apos;intégrité continue.
            </p>
          </Section>

          <Section title="10. Vos droits">
            <p>
              Conformément aux articles 32 et suivants de la loi n° 18-07, vous
              disposez d&apos;un droit d&apos;accès, de rectification, de mise à
              jour, d&apos;opposition pour motifs légitimes et de suppression de
              vos données, ainsi que du droit de retirer votre consentement à
              tout moment pour les traitements qui en dépendent.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                La plupart des données se corrigent directement dans
                l&apos;application (profil, adresses).
              </li>
              <li>
                La suppression du compte s&apos;effectue depuis
                l&apos;application ou la page{" "}
                <Link
                  href="/compte/supprimer"
                  className="text-primary-700 font-medium hover:underline"
                >
                  Supprimer mon compte
                </Link>
                .
              </li>
              <li>
                Pour toute autre demande (y compris la suppression de données
                déterminées sans supprimer le compte), écrivez à{" "}
                <a
                  href={`mailto:${APP_CONFIG.contact.supportEmail}`}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {APP_CONFIG.contact.supportEmail}
                </a>{" "}
                (réponse dans les meilleurs délais, avec vérification
                d&apos;identité). Vous pouvez également saisir l&apos;ANPDP.
              </li>
            </ul>
          </Section>

          <Section title="11. Mineurs">
            <p>
              La Plateforme est réservée aux personnes âgées d&apos;au moins 19
              ans. Aucune donnée relative à des mineurs n&apos;est
              volontairement collectée ; tout compte détecté comme appartenant à
              un mineur est supprimé.
            </p>
          </Section>

          <Section title="12. Cookies, traceurs et mesure d'audience">
            <p>
              Le site utilise des traceurs strictement nécessaires au
              fonctionnement (session, préférences de langue et de thème) et un
              outil de mesure d&apos;audience (Google Analytics) produisant des
              statistiques de fréquentation. Les notifications push ne sont
              activées qu&apos;avec votre accord et se désactivent dans les
              réglages de l&apos;application ou de l&apos;appareil.
            </p>
          </Section>

          <Section title="13. Modifications">
            <p>
              La présente politique peut être mise à jour ; la date en tête de
              page fait foi. En cas de changement substantiel (nouvelle
              finalité, nouveau partage), vous en serez informé via la
              Plateforme et, lorsque la loi l&apos;exige, votre consentement
              sera recueilli à nouveau.
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
