import Link from "next/link";
import {
  ArrowLeft,
  HelpCircle,
  Mail,
  MessageCircle,
  ShieldCheck,
  Store,
} from "lucide-react";
import { APP_CONFIG } from "@/lib/config/app-config";
import { LEGAL } from "@/lib/config/legal";

export const metadata = { title: "Nous contacter" };

export default function ContactPage() {
  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>

        <h1 className="text-foreground text-2xl font-bold">Nous contacter</h1>
        <p className="text-muted mt-1 text-sm">
          Notre équipe vous répond 7j/7. Pour les questions fréquentes, le{" "}
          <Link
            href="/centre-aide"
            className="text-primary-700 font-medium hover:underline"
          >
            centre d&apos;aide
          </Link>{" "}
          contient déjà la plupart des réponses.
        </p>

        <div className="mt-6 space-y-4">
          <Card
            icon={<MessageCircle className="text-primary-600 size-5" />}
            title="Une commande ou une course en cours ?"
          >
            Le plus rapide : le <strong>chat intégré</strong> de
            l&apos;application (depuis le suivi de commande ou la page
            d&apos;aide de votre espace). Vous êtes mis en relation directement
            avec le livreur ou avec le support.
          </Card>

          <Card
            icon={<Mail className="text-primary-600 size-5" />}
            title="Support général (clients, livreurs, chauffeurs, agents)"
          >
            Écrivez-nous à{" "}
            <a
              href={`mailto:${APP_CONFIG.contact.supportEmail}`}
              className="text-primary-700 font-medium hover:underline"
            >
              {APP_CONFIG.contact.supportEmail}
            </a>{" "}
            en précisant votre numéro de commande ou de course si votre demande
            en concerne une. Nous répondons dans les meilleurs délais.
          </Card>

          <Card
            icon={<Store className="text-primary-600 size-5" />}
            title="Devenir commerçant ou partenaire"
          >
            Vous êtes commerçant, livreur, chauffeur ou souhaitez devenir Agent
            Coligo Pay ? Écrivez à{" "}
            <a
              href={`mailto:${APP_CONFIG.contact.salesEmail}`}
              className="text-primary-700 font-medium hover:underline"
            >
              {APP_CONFIG.contact.salesEmail}
            </a>{" "}
            ou créez directement votre compte depuis la page{" "}
            <Link
              href="/login"
              className="text-primary-700 font-medium hover:underline"
            >
              Espace partenaires
            </Link>
            .
          </Card>

          <Card
            icon={<ShieldCheck className="text-primary-600 size-5" />}
            title="Données personnelles et demandes légales"
          >
            Pour exercer vos droits (accès, rectification, suppression —{" "}
            <Link
              href="/confidentialite"
              className="text-primary-700 font-medium hover:underline"
            >
              politique de confidentialité
            </Link>
            ) ou pour toute demande légale, écrivez à{" "}
            <a
              href={`mailto:${APP_CONFIG.contact.supportEmail}`}
              className="text-primary-700 font-medium hover:underline"
            >
              {APP_CONFIG.contact.supportEmail}
            </a>{" "}
            avec l&apos;objet « Données personnelles ».
          </Card>

          <Card
            icon={<HelpCircle className="text-primary-600 size-5" />}
            title="Identité de l'exploitant"
          >
            {LEGAL.platform} est exploitée par M. {LEGAL.ownerFullName},{" "}
            {LEGAL.status.toLowerCase()} immatriculé au{" "}
            {LEGAL.registrationLabel} sous le n° {LEGAL.registrationNumber},{" "}
            {LEGAL.country} — voir les{" "}
            <Link
              href="/mentions-legales"
              className="text-primary-700 font-medium hover:underline"
            >
              mentions légales
            </Link>
            .
          </Card>
        </div>
      </div>
    </main>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-surface rounded-[16px] border p-5">
      <div className="flex items-center gap-2.5">
        {icon}
        <h2 className="text-foreground text-base font-semibold">{title}</h2>
      </div>
      <p className="text-muted mt-2 text-sm leading-relaxed">{children}</p>
    </section>
  );
}
