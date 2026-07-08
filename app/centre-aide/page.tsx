import Link from "next/link";
import {
  ArrowLeft,
  Car,
  ChevronDown,
  Handshake,
  LifeBuoy,
  ShoppingBag,
  UserRound,
  Wallet,
} from "lucide-react";
import { APP_CONFIG } from "@/lib/config/app-config";
import { getFeatureFlags, isVisible } from "@/lib/data/feature-flags";

export const metadata = { title: "Centre d'aide" };

type Faq = { q: string; a: React.ReactNode };
type Section = { icon: React.ReactNode; title: string; items: Faq[] };

// La FAQ s'adapte aux services actifs (voir /admin/controle) : un service
// masqué (« hidden ») n'apparaît pas.
function buildSections(opts: {
  drive: boolean;
  pay: boolean;
  onlinePay: boolean;
  delivery: boolean;
}): Section[] {
  const { drive, pay, onlinePay, delivery } = opts;
  const sections: Section[] = [];

  sections.push({
    icon: <ShoppingBag className="text-primary-600 size-4" />,
    title: delivery ? "Commandes & livraison" : "Commandes & retrait",
    items: [
      {
        q: "Comment passer une commande ?",
        a: (
          <>
            Choisissez un commerce près de chez vous, ajoutez vos produits au
            panier puis validez :{" "}
            {delivery ? (
              <>
                vous choisissez la <strong>livraison</strong>, le{" "}
                <strong>retrait sur place</strong> ou une commande{" "}
                <strong>programmée</strong>
              </>
            ) : (
              <>
                vous retirez <strong>sur place</strong>, immédiatement ou via
                une commande <strong>programmée</strong>
              </>
            )}
            . Le détail des frais s&apos;affiche toujours avant la confirmation.
          </>
        ),
      },
      ...(delivery
        ? [
            {
              q: "Comment suivre ma livraison ?",
              a: (
                <>
                  Depuis <strong>Mes commandes</strong>, ouvrez la commande en
                  cours : vous suivez chaque étape en temps réel (préparation,
                  livreur en route, arrivée) sur la carte, et vous pouvez
                  discuter avec le livreur via le chat intégré.
                </>
              ),
            },
          ]
        : []),
      {
        q: "Comment fonctionne le retrait sur place ?",
        a: (
          <>
            À la validation, vous recevez un <strong>code de retrait</strong>{" "}
            confidentiel (différent du numéro de commande). Présentez-le au
            commerçant — ou son QR — pour récupérer votre commande.
          </>
        ),
      },
      {
        q: "Un produit est manquant ou non conforme, que faire ?",
        a: (
          <>
            Signalez-le au support au plus vite depuis la commande concernée ou
            via la page <strong>Nous contacter</strong>, en précisant le numéro
            de commande. Après vérification, un remboursement
            {pay
              ? " (en solde Coligo Pay ou selon le mode de paiement)"
              : ""}{" "}
            peut être appliqué.
          </>
        ),
      },
      {
        q: "Puis-je annuler une commande ?",
        a: (
          <>
            Tant que le commerçant n&apos;a pas commencé la préparation, vous
            pouvez annuler depuis la commande. Ensuite, contactez le support qui
            arbitre au cas par cas.
          </>
        ),
      },
    ],
  });

  if (drive) {
    sections.push({
      icon: <Car className="text-primary-600 size-4" />,
      title: "Coligo Drive (trajets)",
      items: [
        {
          q: "Comment réserver une course ?",
          a: (
            <>
              Ouvrez <strong>Drive</strong>, indiquez votre destination : le
              prix est <strong>annoncé avant la confirmation</strong>, sans
              surprise. Un chauffeur proche accepte, vous suivez son arrivée sur
              la carte.
            </>
          ),
        },
        {
          q: "Le prix peut-il changer pendant la course ?",
          a: (
            <>
              Non : le prix annoncé à la réservation est le prix payé, sauf
              modification de la destination en cours de route demandée par
              vous.
            </>
          ),
        },
        {
          q: "Mon numéro est-il visible par le chauffeur ?",
          a: (
            <>
              Par défaut, votre numéro est <strong>masqué</strong> : les appels
              et messages passent par l&apos;application.
            </>
          ),
        },
        {
          q: "J'ai oublié un objet dans un véhicule.",
          a: (
            <>
              Contactez le support avec la référence de la course : nous faisons
              le lien avec le chauffeur pour organiser la restitution.
            </>
          ),
        },
      ],
    });
  }

  if (pay || onlinePay) {
    sections.push({
      icon: <Wallet className="text-primary-600 size-4" />,
      title: "Paiements",
      items: [
        ...(pay
          ? [
              {
                q: "C'est quoi le solde Coligo Pay ?",
                a: (
                  <>
                    Un <strong>solde prépayé</strong> utilisable pour régler vos
                    commandes{drive ? " et courses" : ""} dans
                    l&apos;application. Ce n&apos;est pas un compte bancaire :
                    il ne produit pas d&apos;intérêts et s&apos;utilise
                    uniquement sur Coligo.
                  </>
                ),
              },
              {
                q: "Comment recharger mon solde ?",
                a: (
                  <>
                    Rendez-vous chez un <strong>Agent Coligo Pay</strong> près
                    de chez vous (visibles sur la carte dans l&apos;application)
                    : vous payez en espèces, votre solde est crédité
                    immédiatement.
                  </>
                ),
              },
              {
                q: "Puis-je récupérer mon solde en espèces ?",
                a: (
                  <>
                    Le solde sert d&apos;abord à payer sur la plateforme. En cas
                    de besoin, contactez le support : après vérification
                    d&apos;identité, un remboursement est possible selon la
                    procédure indiquée.
                  </>
                ),
              },
            ]
          : []),
        ...(onlinePay
          ? [
              {
                q: "Le paiement par carte est-il disponible ?",
                a: (
                  <>
                    Le paiement en ligne s&apos;effectue par carte CIB /
                    Edahabia via les prestataires agréés en Algérie. Coligo ne
                    stocke jamais vos données de carte.
                  </>
                ),
              },
            ]
          : []),
      ],
    });
  }

  sections.push({
    icon: <UserRound className="text-primary-600 size-4" />,
    title: "Compte & sécurité",
    items: [
      {
        q: "Comment modifier mes informations ?",
        a: (
          <>
            Dans <strong>Mon compte</strong>, vous pouvez modifier vos
            coordonnées, adresses et préférences (langue français / arabe,
            thème).
          </>
        ),
      },
      {
        q: "Comment supprimer mon compte ?",
        a: (
          <>
            Depuis <strong>Mon compte → Supprimer mon compte</strong> (ou la
            page{" "}
            <Link
              href="/compte/supprimer"
              className="text-primary-700 font-medium hover:underline"
            >
              dédiée
            </Link>
            ). La suppression anonymise vos données personnelles conformément à
            notre politique de confidentialité.
          </>
        ),
      },
      {
        q: "Je soupçonne une utilisation frauduleuse de mon compte.",
        a: (
          <>
            Changez immédiatement votre mot de passe puis contactez le support.
            Nous pouvons geler le compte le temps des vérifications.
          </>
        ),
      },
    ],
  });

  sections.push({
    icon: <Handshake className="text-primary-600 size-4" />,
    title: "Devenir partenaire",
    items: [
      {
        q: "Comment inscrire mon commerce ?",
        a: (
          <>
            Créez votre compte boutique depuis la page{" "}
            <Link
              href="/signup"
              className="text-primary-700 font-medium hover:underline"
            >
              Devenir commerçant
            </Link>{" "}
            : l&apos;inscription est gratuite, votre compte est activé après
            vérification de vos documents (immatriculation).
          </>
        ),
      },
      ...(delivery || drive
        ? [
            {
              q: `Comment devenir ${[
                ...(delivery ? ["livreur"] : []),
                ...(drive ? ["chauffeur"] : []),
              ].join(" ou ")} ?`,
              a: (
                <>
                  Inscrivez-vous depuis l&apos;espace partenaires avec vos
                  documents (pièce d&apos;identité, permis, assurance,
                  véhicule). Après validation, vous choisissez librement vos
                  horaires de connexion.
                </>
              ),
            },
          ]
        : []),
      ...(pay
        ? [
            {
              q: "Comment devenir Agent Coligo Pay ?",
              a: (
                <>
                  Les commerces peuvent devenir points de recharge agréés et
                  percevoir une commission sur les recharges. Candidatez depuis
                  l&apos;espace partenaires ou écrivez-nous.
                </>
              ),
            },
          ]
        : []),
    ],
  });

  return sections;
}

export default async function CentreAidePage() {
  const flags = await getFeatureFlags();
  const sections = buildSections({
    drive: isVisible(flags.drive),
    pay: isVisible(flags.coligo_pay),
    onlinePay: isVisible(flags.online_payment),
    delivery: isVisible(flags.express) || isVisible(flags.tour),
  });

  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>

        <header className="mb-6">
          <h1 className="text-foreground flex items-center gap-2 text-2xl font-bold">
            <LifeBuoy className="text-primary-600 size-6" />
            Centre d&apos;aide
          </h1>
          <p className="text-muted mt-1 text-sm">
            Les réponses aux questions les plus fréquentes, pour les clients
            comme pour les partenaires.
          </p>
        </header>

        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-muted mb-2 flex items-center gap-1.5 text-sm font-semibold tracking-wide uppercase">
                {section.icon}
                {section.title}
              </h2>
              <div className="border-border bg-surface divide-border divide-y overflow-hidden rounded-[16px] border">
                {section.items.map((item) => (
                  <details key={item.q} className="group">
                    <summary className="hover:bg-surface-2 flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium transition-colors">
                      <span>{item.q}</span>
                      <ChevronDown className="text-muted size-4 shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="text-muted px-5 pb-4 text-sm leading-relaxed">
                      {item.a}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="border-primary-200 bg-primary-50 mt-8 rounded-[16px] border p-5 text-center">
          <p className="text-foreground text-base font-semibold">
            Vous n&apos;avez pas trouvé votre réponse ?
          </p>
          <p className="text-muted mt-1 mb-4 text-sm">
            Notre équipe vous répond directement.
          </p>
          <Link
            href="/contact"
            className="bg-primary-600 hover:bg-primary-700 inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            Nous contacter
          </Link>
          <p className="text-subtle mt-3 text-xs">
            ou par e-mail :{" "}
            <a
              href={`mailto:${APP_CONFIG.contact.supportEmail}`}
              className="hover:underline"
            >
              {APP_CONFIG.contact.supportEmail}
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
