import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_CONFIG } from "@/lib/config/app-config";
import { LEGAL } from "@/lib/config/legal";
import { getFeatureFlags, isVisible } from "@/lib/data/feature-flags";

export const metadata = { title: "Conditions générales d'utilisation" };

// Les CGU s'adaptent aux services réellement proposés : un service masqué par
// le super-admin (statut « hidden ») disparaît du document ; un service en
// « bientôt disponible » / « maintenance » y reste (il est proposé, juste
// temporairement indisponible). Numérotation des articles recalculée.
export default async function CguPage() {
  const flags = await getFeatureFlags();
  const drive = isVisible(flags.drive);
  const pay = isVisible(flags.coligo_pay);
  // Réseau d'agents Coligo Pay (kill-switch domaine, mig 0449).
  const agents = pay && flags.coligo_pay_agents.status === "active";
  const onlinePay = isVisible(flags.online_payment);
  const delivery = isVisible(flags.express) || isVisible(flags.tour);

  const roles = [
    "clients",
    "commerçants partenaires",
    ...(delivery ? ["livreurs partenaires"] : []),
    ...(drive ? ["chauffeurs partenaires"] : []),
    ...(agents ? ["agents Coligo Pay"] : []),
  ].join(", ");

  const partnerKinds = [
    "commerçants",
    ...(delivery ? ["livreurs"] : []),
    ...(drive ? ["chauffeurs"] : []),
  ].join(", ");

  const payMethods = [
    ...(delivery ? ["en espèces à la livraison"] : ["en espèces au retrait"]),
    ...(pay ? ["via le solde Coligo Pay"] : []),
    ...(onlinePay
      ? [
          "en ligne par carte CIB / Edahabia via les prestataires de paiement agréés en Algérie",
        ]
      : []),
  ].join(", ");

  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: "Éditeur de la plateforme",
      body: (
        <p>
          La plateforme {LEGAL.platform} (site {LEGAL.site} et applications
          mobiles associées, ci-après « la Plateforme ») est éditée et exploitée
          par M. {LEGAL.ownerFullName}, exerçant sous le statut d&apos;
          {LEGAL.status.toLowerCase()} régi par la {LEGAL.statusLaw},
          immatriculé au {LEGAL.registrationLabel} sous le numéro{" "}
          <strong>{LEGAL.registrationNumber}</strong>, dont le siège est situé à{" "}
          {LEGAL.address} (ci-après « {LEGAL.platform} » ou « nous »). Contact :{" "}
          <a
            href={`mailto:${APP_CONFIG.contact.supportEmail}`}
            className="text-primary-700 font-medium hover:underline"
          >
            {APP_CONFIG.contact.supportEmail}
          </a>
          .
        </p>
      ),
    },
    {
      title: "Objet et acceptation",
      body: (
        <>
          <p>
            Les présentes conditions générales d&apos;utilisation (« CGU »)
            régissent l&apos;accès et l&apos;utilisation de la Plateforme par
            l&apos;ensemble de ses utilisateurs : {roles}. Elles sont conclues
            en application des dispositions du droit algérien, notamment la loi
            n° 18-05 du 10 mai 2018 relative au commerce électronique et la loi
            n° 09-03 du 25 février 2009 relative à la protection du consommateur
            et à la répression des fraudes.
          </p>
          <p>
            <strong>
              La création d&apos;un compte, l&apos;accès à la Plateforme ou la
              passation d&apos;une commande valent acceptation pleine et entière
              des présentes CGU.
            </strong>{" "}
            {LEGAL.platform} peut les faire évoluer ; les utilisateurs sont
            informés de toute modification substantielle et la poursuite de
            l&apos;utilisation vaut acceptation de la version en vigueur. La
            liste des services proposés peut évoluer ; les présentes
            s&apos;appliquent aux services effectivement disponibles dans
            l&apos;application.
          </p>
        </>
      ),
    },
    {
      title: "Définitions",
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Client</strong> : toute personne physique qui utilise la
            Plateforme pour commander des produits
            {delivery ? ", se faire livrer" : ""}
            {drive ? " ou réserver une course" : ""}.
          </li>
          <li>
            <strong>Commerçant partenaire</strong> : professionnel régulièrement
            immatriculé (registre du commerce, carte d&apos;artisan ou statut
            équivalent) proposant ses produits à la vente sur la Plateforme.
          </li>
          {delivery && (
            <li>
              <strong>Livreur partenaire</strong> : prestataire indépendant
              assurant la livraison des commandes.
            </li>
          )}
          {drive && (
            <li>
              <strong>Chauffeur partenaire</strong> : conducteur indépendant
              proposant des trajets via le service Coligo Drive.
            </li>
          )}
          {agents && (
            <li>
              <strong>Agent Coligo Pay</strong> : partenaire indépendant agréé
              par {LEGAL.platform} comme point de recharge du solde Coligo Pay.
            </li>
          )}
          {pay && (
            <li>
              <strong>Coligo Pay</strong> : solde prépayé interne à la
              Plateforme (voir l&apos;article dédié).
            </li>
          )}
        </ul>
      ),
    },
    {
      title: "Inscription et compte",
      body: (
        <>
          <p>
            L&apos;inscription est réservée aux personnes âgées d&apos;au moins
            dix-neuf (19) ans, âge de la majorité civile en Algérie (article 40
            du Code civil). L&apos;utilisateur s&apos;engage à fournir des
            informations exactes, complètes et à jour, et à les maintenir ainsi.
            Chaque compte est strictement personnel : l&apos;utilisateur
            préserve la confidentialité de ses identifiants et demeure
            responsable de toute activité réalisée depuis son compte. En cas
            d&apos;utilisation frauduleuse suspectée, il informe{" "}
            {LEGAL.platform} sans délai.
          </p>
          <p>
            L&apos;inscription des partenaires est soumise à la vérification
            préalable de leurs documents (immatriculation, pièce
            d&apos;identité, permis de conduire, assurance et documents du
            véhicule le cas échéant). {LEGAL.platform} peut refuser ou suspendre
            toute candidature ne satisfaisant pas à ces exigences.
          </p>
        </>
      ),
    },
    {
      title: "Rôle de la plateforme : intermédiation",
      body: (
        <>
          <p>
            {LEGAL.platform} est un service d&apos;intermédiation technique au
            sens de la loi n° 18-05 : la Plateforme met en relation les clients
            avec des partenaires indépendants ({partnerKinds}). {LEGAL.platform}{" "}
            n&apos;est ni vendeur des produits proposés par les commerçants, ni
            transporteur : le contrat de vente se forme directement entre le
            client et le commerçant
            {delivery || drive
              ? ", et la prestation de transport ou de livraison est exécutée par le partenaire indépendant qui l'accepte"
              : ""}
            .
          </p>
          <p>
            Les partenaires exercent en toute indépendance : ils ne sont liés à{" "}
            {LEGAL.platform} par aucun contrat de travail et demeurent seuls
            responsables du respect de leurs obligations légales, fiscales,
            sociales et réglementaires (immatriculation, hygiène et sécurité
            alimentaire, permis, assurances, code de la route).
          </p>
        </>
      ),
    },
    {
      title: delivery ? "Commandes et livraison" : "Commandes et retrait",
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Les prix sont affichés en dinars algériens (DA), toutes taxes
            comprises, conformément à la loi n° 04-02 relative aux pratiques
            commerciales. Les frais de service{" "}
            {delivery ? "et de livraison " : ""}sont affichés avant validation
            de la commande et figés au moment de celle-ci.
          </li>
          <li>
            {delivery ? (
              <>
                Le client choisit la livraison (selon les modes disponibles :
                immédiate ou en tournée planifiée), le retrait sur place ou, le
                cas échéant, une commande programmée.
              </>
            ) : (
              <>
                Le client retire sa commande sur place, immédiatement ou via une
                commande programmée.
              </>
            )}{" "}
            Le retrait s&apos;effectue au moyen du code confidentiel ou de la
            référence du ticket présentés par le client.
          </li>
          {delivery && (
            <>
              <li>
                Les délais de livraison sont donnés à titre indicatif et peuvent
                varier selon la circulation, la météo et la disponibilité des
                partenaires.
              </li>
              <li>
                En cas d&apos;absence du destinataire au point de livraison
                après le délai d&apos;attente indiqué dans l&apos;application,
                la commande peut être clôturée et les sommes dues rester à la
                charge du client, après examen par le support.
              </li>
            </>
          )}
          <li>
            Toute réclamation relative à une commande (produit manquant, non
            conforme{delivery ? ", retard anormal" : ""}) doit être signalée au
            support dans les meilleurs délais pour permettre son traitement.
          </li>
        </ul>
      ),
    },
    {
      title: "Dispositions propres aux commerçants",
      body: (
        <p>
          Le commerçant partenaire garantit qu&apos;il est régulièrement
          immatriculé et autorisé à vendre les produits qu&apos;il propose ; il
          est seul responsable de la conformité, de la qualité, de
          l&apos;hygiène et de l&apos;étiquetage de ses produits au regard de la
          loi n° 09-03 et de ses textes d&apos;application, ainsi que de
          l&apos;exactitude de son catalogue (prix, disponibilité, photos).{" "}
          {LEGAL.platform} perçoit une commission sur les ventes réalisées via
          la Plateforme ainsi que, le cas échéant, des frais de service ; les
          taux applicables sont communiqués au commerçant et figés commande par
          commande. Les sommes dues au commerçant sont retracées dans son espace
          « Mon argent » et versées selon la procédure de versement décrite dans
          l&apos;application, avec édition de factures récapitulatives.
        </p>
      ),
    },
  ];

  if (delivery || drive) {
    sections.push({
      title:
        delivery && drive
          ? "Dispositions propres aux livreurs et chauffeurs"
          : delivery
            ? "Dispositions propres aux livreurs"
            : "Dispositions propres aux chauffeurs",
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Le partenaire déclare détenir l&apos;ensemble des documents requis
            en cours de validité : pièce d&apos;identité, permis de conduire,
            assurance, documents du véhicule, et statut professionnel le cas
            échéant. Il s&apos;engage à respecter le code de la route et à se
            comporter avec courtoisie.
          </li>
          <li>
            Le partenaire est libre de se connecter, d&apos;accepter ou de
            refuser une {drive ? "course" : "livraison"}
            {delivery && drive ? " ou une livraison" : ""}. Sa rémunération et
            les frais de service {LEGAL.platform} applicables lui sont présentés
            dans l&apos;application avant acceptation puis retracés dans ses
            relevés.
          </li>
          {delivery && (
            <li>
              Lorsqu&apos;un partenaire encaisse des espèces pour le compte
              d&apos;un commerçant ou de {LEGAL.platform} (paiement à la
              livraison), il les détient en qualité de simple dépositaire et
              doit les reverser conformément aux relevés générés par la
              Plateforme.
            </li>
          )}
          <li>
            Des plafonds d&apos;encaissement, contrôles anti-fraude et
            procédures de gel ou de blocage du compte peuvent être appliqués en
            cas d&apos;irrégularité.
          </li>
        </ul>
      ),
    });
  }

  if (drive) {
    sections.push({
      title: "Coligo Drive (mise en relation de transport)",
      body: (
        <p>
          Coligo Drive met en relation des clients et des chauffeurs partenaires
          indépendants. Le prix de la course est annoncé avant confirmation. Le
          client et le chauffeur peuvent annuler dans les conditions affichées
          dans l&apos;application ; les annulations abusives ou les absences
          répétées (no-show) peuvent donner lieu à des frais ou à la suspension
          du compte, après examen. Les numéros de téléphone peuvent être masqués
          pour protéger la vie privée des deux parties.
        </p>
      ),
    });
  }

  if (pay) {
    sections.push({
      title: agents ? "Coligo Pay et agents de recharge" : "Coligo Pay",
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Coligo Pay est un <strong>solde prépayé interne</strong> utilisable
            exclusivement pour régler des commandes{drive ? ", courses" : ""} et
            services au sein de la Plateforme. Il ne constitue ni un compte
            bancaire, ni un instrument de paiement universel, ne produit aucun
            intérêt et n&apos;est pas cessible entre utilisateurs en dehors des
            fonctionnalités prévues par la Plateforme.
          </li>
          <li>
            {agents
              ? "La recharge s'effectue auprès des Agents Coligo Pay agréés ou par tout autre moyen proposé dans l'application."
              : "La recharge s'effectue par les moyens proposés dans l'application."}{" "}
            Chaque opération (recharge, paiement, remboursement) est inscrite
            dans un registre horodaté et infalsifiable.
          </li>
          <li>
            Le remboursement d&apos;un solde s&apos;effectue sur demande auprès
            du support, après vérification d&apos;identité, selon les modalités
            et délais communiqués par celui-ci.
          </li>
          <li>
            {LEGAL.platform} peut plafonner les soldes et opérations et
            suspendre toute opération suspecte dans le cadre de la lutte contre
            la fraude.
          </li>
        </ul>
      ),
    });
  }

  sections.push(
    {
      title: "Paiements",
      body: (
        <p>
          Les paiements s&apos;effectuent en dinars algériens : {payMethods}.
          {onlinePay ? (
            <>
              {" "}
              Les paiements en ligne sont traités par ces prestataires ;{" "}
              {LEGAL.platform} ne stocke pas les données de carte bancaire.
            </>
          ) : null}{" "}
          Le détail des montants (produits, frais de service
          {delivery ? ", livraison" : ""}, remises) est affiché avant validation
          et repris dans l&apos;historique de commande.
        </p>
      ),
    },
    {
      title: "Promotions, codes et bons",
      body: (
        <p>
          Les codes promotionnels, bons d&apos;achat, remises et programmes de
          fidélité sont soumis à leurs conditions propres (durée, plafond,
          services éligibles) affichées dans l&apos;application. Ils ne sont ni
          remboursables ni convertibles en espèces. {LEGAL.platform} peut
          retirer un avantage obtenu par fraude, détournement ou usage de
          comptes multiples.
        </p>
      ),
    },
    {
      title: "Obligations et interdictions",
      body: (
        <>
          <p>Il est notamment interdit :</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              d&apos;utiliser la Plateforme à des fins illicites, frauduleuses
              ou contraires à l&apos;ordre public, ou de commander des produits
              dont la vente est interdite ou réglementée ;
            </li>
            <li>
              de créer de faux comptes, de passer de fausses commandes,
              d&apos;usurper l&apos;identité d&apos;autrui ou de manipuler les
              notations et avis ;
            </li>
            <li>
              de porter atteinte au fonctionnement de la Plateforme (intrusion,
              extraction massive de données, ingénierie inverse), comportements
              par ailleurs réprimés par la loi n° 09-04 du 5 août 2009 relative
              à la lutte contre les infractions liées aux technologies de
              l&apos;information et de la communication ;
            </li>
            <li>
              d&apos;adopter tout comportement violent, discriminatoire ou de
              harcèlement envers un autre utilisateur ou partenaire.
            </li>
          </ul>
        </>
      ),
    },
    {
      title: "Suspension et résiliation",
      body: (
        <p>
          L&apos;utilisateur peut cesser d&apos;utiliser la Plateforme à tout
          moment et demander la suppression de son compte depuis
          l&apos;application (page « Supprimer mon compte »). {LEGAL.platform}{" "}
          peut suspendre (gel) ou résilier (blocage) un compte en cas de
          manquement aux présentes CGU, de fraude, de défaut de reversement des
          sommes dues ou de comportement mettant en danger d&apos;autres
          utilisateurs, après information de l&apos;intéressé sauf urgence. La
          suspension ou la résiliation ne fait pas obstacle au règlement des
          sommes restant dues de part et d&apos;autre.
        </p>
      ),
    },
    {
      title: "Notation et avis",
      body: (
        <p>
          Les clients peuvent noter les partenaires (et réciproquement le cas
          échéant). Les avis doivent rester honnêtes et respectueux.{" "}
          {LEGAL.platform} peut retirer un avis manifestement frauduleux,
          injurieux ou étranger à la prestation. Les notations participent aux
          dispositifs de qualité de service de la Plateforme.
        </p>
      ),
    },
    {
      title: "Propriété intellectuelle",
      body: (
        <p>
          La marque {LEGAL.platform}, ses logos, l&apos;application, sa charte
          graphique, ses textes et ses bases de données sont protégés notamment
          par l&apos;ordonnance n° 03-05 du 19 juillet 2003 relative aux droits
          d&apos;auteur et droits voisins et par l&apos;ordonnance n° 03-06 du
          19 juillet 2003 relative aux marques. Toute reproduction ou
          exploitation non autorisée est interdite. Le commerçant concède à{" "}
          {LEGAL.platform} une licence d&apos;utilisation de ses éléments (nom,
          logo, photos de produits) aux seules fins d&apos;exploitation et de
          promotion de la Plateforme.
        </p>
      ),
    },
    {
      title: "Données personnelles",
      body: (
        <p>
          Les traitements de données personnelles réalisés par la Plateforme
          sont décrits dans la{" "}
          <Link
            href="/confidentialite"
            className="text-primary-700 font-medium hover:underline"
          >
            Politique de confidentialité
          </Link>
          , établie conformément à la loi n° 18-07 du 10 juin 2018 relative à la
          protection des personnes physiques dans le traitement des données à
          caractère personnel.
        </p>
      ),
    },
    {
      title: "Responsabilité",
      body: (
        <p>
          {LEGAL.platform} met en œuvre les moyens raisonnables pour assurer un
          service disponible, sécurisé et conforme. En sa qualité
          d&apos;intermédiaire, {LEGAL.platform} ne saurait être tenue
          responsable des manquements imputables aux commerçants (qualité et
          conformité des produits)
          {delivery || drive
            ? `, aux ${[
                ...(delivery ? ["livreurs"] : []),
                ...(drive ? ["chauffeurs"] : []),
              ].join(" ou aux ")} (exécution du transport)`
            : ""}
          , ni des dommages résultant d&apos;une utilisation fautive de la
          Plateforme, d&apos;un cas de force majeure, d&apos;une interruption
          des réseaux de télécommunication ou des systèmes de paiement. Les
          recours du client au titre de la garantie des produits s&apos;exercent
          contre le commerçant, sans préjudice de l&apos;assistance que le
          support {LEGAL.platform} apporte au traitement des réclamations
          (remboursements, gestes commerciaux, médiation entre les parties).
        </p>
      ),
    },
    {
      title: "Réclamations et médiation",
      body: (
        <p>
          Toute réclamation s&apos;effectue en priorité via le{" "}
          <Link
            href="/centre-aide"
            className="text-primary-700 font-medium hover:underline"
          >
            centre d&apos;aide
          </Link>{" "}
          ou à l&apos;adresse{" "}
          <a
            href={`mailto:${APP_CONFIG.contact.supportEmail}`}
            className="text-primary-700 font-medium hover:underline"
          >
            {APP_CONFIG.contact.supportEmail}
          </a>
          . Les parties s&apos;efforcent de résoudre amiablement tout différend
          avant toute action contentieuse. Le client conserve la faculté de
          saisir les associations de protection du consommateur et les services
          compétents du ministère du Commerce.
        </p>
      ),
    },
    {
      title: "Droit applicable et juridiction",
      body: (
        <p>
          Les présentes CGU sont régies par le droit algérien. À défaut de
          règlement amiable, tout litige relève des juridictions algériennes
          territorialement compétentes conformément au code de procédure civile
          et administrative, sans préjudice des règles protectrices applicables
          aux consommateurs.
        </p>
      ),
    },
    {
      title: "Dispositions diverses",
      body: (
        <p>
          Si une stipulation des présentes CGU était déclarée nulle, les autres
          stipulations conserveraient leur plein effet. Le fait pour{" "}
          {LEGAL.platform} de ne pas se prévaloir d&apos;un manquement ne vaut
          pas renonciation. Les CGU sont rédigées en langue française ; toute
          traduction est fournie à titre informatif, la version française
          prévalant en cas de divergence.
        </p>
      ),
    }
  );

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
          Conditions générales d&apos;utilisation
        </h1>
        <p className="text-muted mt-1 text-sm">
          Dernière mise à jour : {LEGAL.lastUpdate}
        </p>

        <div className="text-foreground mt-6 space-y-6 text-sm leading-relaxed">
          {sections.map((s, i) => (
            <Section key={s.title} title={`${i + 1}. ${s.title}`}>
              {s.body}
            </Section>
          ))}
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
