import { ChevronDown, LifeBuoy } from "lucide-react";
import { MerchantSupportCta } from "@/components/merchant/support-cta";

export const metadata = { title: "Aide & support" };

type Faq = { q: string; a: React.ReactNode };
type Section = { title: string; items: Faq[] };

const SECTIONS: Section[] = [
  {
    title: "💰 Mon argent & versements",
    items: [
      {
        q: "Que veut dire « en cours de versement » ?",
        a: (
          <>
            C&apos;est un versement que vous avez <strong>déjà demandé</strong>{" "}
            et que Coligo n&apos;a pas encore payé. Ce montant est{" "}
            <strong>réservé</strong> pour ne pas être demandé deux fois. Dès
            qu&apos;il est payé sur votre compte, il disparaît de cette ligne.
          </>
        ),
      },
      {
        q: "Pourquoi je ne peux pas retirer tout mon solde ?",
        a: (
          <>
            Le montant « à retirer maintenant » = votre solde{" "}
            <strong>moins</strong> les versements déjà demandés (en cours).
            <br />
            <span className="text-subtle">
              Exemple : solde 5 207 DA − 1 900 DA déjà demandés = 3 307 DA
              disponibles.
            </span>{" "}
            Une fois les 1 900 DA payés, ils quittent « en cours » et votre
            solde devient 3 307 DA.
          </>
        ),
      },
      {
        q: "Que veut dire « Coligo vous doit » ou « Vous devez à Coligo » ?",
        a: (
          <>
            <strong>Coligo vous doit</strong> : l&apos;argent de vos ventes en
            ligne et par QR a été encaissé par Coligo pour vous — vous pouvez le
            retirer.
            <br />
            <strong>Vous devez à Coligo</strong> : sur vos ventes en{" "}
            <strong>espèces</strong>, le client vous a payé en main propre. Vous
            gardez l&apos;argent mais vous devez la commission à Coligo.
          </>
        ),
      },
      {
        q: "Comment demander un versement ?",
        a: (
          <>
            Sur la page <strong>Mon argent</strong>, appuyez sur « Demander mon
            versement », saisissez le montant et vos coordonnées (CCP /
            BaridiMob / RIB). Votre demande passe en « en cours » jusqu&apos;à
            son paiement.
          </>
        ),
      },
      {
        q: "Comment télécharger ma facture ?",
        a: (
          <>
            Page <strong>Mon argent</strong> → section{" "}
            <strong>Mes factures mensuelles</strong> → « Télécharger » sur le
            mois voulu. Vous pouvez l&apos;imprimer ou l&apos;enregistrer en
            PDF.
          </>
        ),
      },
    ],
  },
  {
    title: "📊 Commissions & frais",
    items: [
      {
        q: "C'est quoi la commission Coligo ?",
        a: (
          <>
            Un pourcentage prélevé sur le <strong>prix des produits</strong>{" "}
            uniquement (jamais sur les frais de service ni la livraison). Il est
            figé au moment de chaque commande.
          </>
        ),
      },
      {
        q: "C'est quoi les frais de service ?",
        a: (
          <>
            De petits frais payés par le <strong>client</strong>. Pour une vente
            en espèces, vous les encaissez pour Coligo et les lui reversez (ils
            apparaissent donc en « part Coligo » dans votre détail).
          </>
        ),
      },
    ],
  },
  {
    title: "🛵 Livraison",
    items: [
      {
        q: "Différence entre Express et Tournée ?",
        a: (
          <>
            <strong>Express</strong> : Coligo vous envoie un livreur
            immédiatement — vous n&apos;avez rien à gérer.
            <br />
            <strong>Tournée</strong> : <em>votre</em> livreur livre plusieurs
            commandes sur un créneau planifié, au prix que vous fixez.
          </>
        ),
      },
      {
        q: "Quand suis-je payé pour une livraison en espèces ?",
        a: (
          <>
            <strong>Au retrait</strong> : le livreur Express vous remet le
            montant de la commande (commission déduite) en la récupérant. Si le
            client ne répond pas à la livraison, le support peut vous demander
            de reprendre la commande — vous rendez alors cette avance au
            livreur.
          </>
        ),
      },
      {
        q: "Comment je fixe mon prix de livraison en tournée ?",
        a: (
          <>
            Dans <strong>Réglages → Livraison</strong>, vous fixez un prix par
            zone (0-3 / 3-6 / 6-10 km). Vous pouvez le <strong>baisser</strong>{" "}
            pour être plus attractif, mais pas dépasser le plafond imposé par
            Coligo (prix juste). Coligo prélève une petite commission sur ces
            frais.
          </>
        ),
      },
      {
        q: "Comment activer la livraison ?",
        a: (
          <>
            <strong>Réglages → Livraison</strong> : activez la livraison,
            choisissez les modes (Express / Tournée) et placez la position de
            votre boutique sur la carte.
          </>
        ),
      },
    ],
  },
  {
    title: "🧾 Commandes",
    items: [
      {
        q: "Comment imprimer mes tickets automatiquement ?",
        a: (
          <>
            <strong>Réglages → Impression du ticket</strong> : activez
            l&apos;auto-impression et choisissez la largeur de votre imprimante
            (50 / 58 / 80 mm).
          </>
        ),
      },
      {
        q: "Un client ne s'est pas présenté, que faire ?",
        a: (
          <>
            Pour une livraison, le livreur déclare l&apos;absence après un délai
            d&apos;attente. Vous n&apos;êtes pas pénalisé. En cas de doute,
            contactez le support ci-dessous.
          </>
        ),
      },
    ],
  },
];

export default function AidePage() {
  return (
    <div className="mx-auto max-w-[760px] p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight lg:text-3xl">
          <LifeBuoy className="text-primary-600 size-7" />
          Aide & support
        </h1>
        <p className="text-muted mt-1 text-sm">
          Les réponses aux questions les plus fréquentes. Vous ne trouvez pas ?
          Le support est juste en bas.
        </p>
      </header>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-muted mb-2 text-sm font-semibold tracking-wide uppercase">
              {section.title}
            </h2>
            <div className="border-border bg-surface divide-border divide-y overflow-hidden rounded-lg border">
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

      {/* Contact support — APRÈS la FAQ */}
      <section className="border-primary-200 bg-primary-50 mt-6 rounded-lg border p-5 text-center">
        <p className="text-foreground text-base font-semibold">
          Vous n&apos;avez pas trouvé votre réponse ?
        </p>
        <p className="text-muted mt-1 mb-4 text-sm">
          Notre équipe vous répond directement.
        </p>
        <MerchantSupportCta />
      </section>
    </div>
  );
}
