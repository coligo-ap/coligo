import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_CONFIG } from "@/lib/config/app-config";

export const metadata = { title: "Conditions générales d'utilisation" };

export default function CguPage() {
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
          Dernière mise à jour : juin 2026
        </p>

        <div className="text-foreground mt-6 space-y-5 text-sm leading-relaxed">
          <Section title="1. Objet">
            Les présentes conditions régissent l&apos;accès et
            l&apos;utilisation de la plateforme {APP_CONFIG.name} (marketplace,
            livraison, transport et services de paiement associés) par les
            clients, commerçants, livreurs, chauffeurs et partenaires.
          </Section>
          <Section title="2. Compte">
            L&apos;utilisateur s&apos;engage à fournir des informations exactes
            lors de son inscription et à préserver la confidentialité de ses
            identifiants. Toute activité réalisée depuis un compte est réputée
            faite par son titulaire.
          </Section>
          <Section title="3. Services">
            {APP_CONFIG.name} met en relation les utilisateurs et facilite les
            commandes, livraisons, courses et paiements. La disponibilité des
            services peut varier selon la zone géographique et être suspendue
            pour maintenance.
          </Section>
          <Section title="4. Paiements">
            Les paiements en ligne sont traités par des prestataires agréés. Les
            montants, commissions et frais applicables sont affichés avant
            validation. Les soldes de portefeuille sont tracés dans un registre
            inviolable.
          </Section>
          <Section title="5. Obligations des utilisateurs">
            Il est interdit d&apos;utiliser la plateforme à des fins illicites,
            frauduleuses ou portant atteinte aux droits de tiers.{" "}
            {APP_CONFIG.name} se réserve le droit de suspendre tout compte en
            cas de manquement.
          </Section>
          <Section title="6. Responsabilité">
            {APP_CONFIG.name} agit en qualité d&apos;intermédiaire technique et
            ne saurait être tenue responsable des manquements imputables aux
            commerçants, livreurs, chauffeurs ou utilisateurs.
          </Section>
          <Section title="7. Contact">
            Pour toute question relative aux présentes conditions, écrivez-nous
            à{" "}
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
