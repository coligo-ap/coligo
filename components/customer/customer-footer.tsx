import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { APP_CONFIG } from "@/lib/config/app-config";

export function CustomerFooter() {
  return (
    <footer className="border-border mt-12 hidden border-t bg-white lg:block">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-6 py-10 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <Logo variant="amber" size="md" />
          <p className="text-muted max-w-sm text-sm">{APP_CONFIG.tagline}</p>
          <p className="text-subtle text-xs">
            © {new Date().getFullYear()} {APP_CONFIG.name}. Tous droits
            réservés.
          </p>
        </div>

        <Column title="À propos">
          <Item href="/about">Coligo</Item>
          <Item href="/blog">Blog</Item>
          <Item href="/login">Devenir commerçant</Item>
        </Column>

        <Column title="Aide">
          <Item href="/aide">Centre d&apos;aide</Item>
          <Item href={`mailto:${APP_CONFIG.contact.supportEmail}`}>
            Nous contacter
          </Item>
        </Column>

        <Column title="Légal">
          <Item href="/cgu">Conditions générales</Item>
          <Item href="/confidentialite">Confidentialité</Item>
        </Column>
      </div>
    </footer>
  );
}

function Column({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-foreground text-sm font-semibold">{title}</p>
      <ul className="space-y-1.5 text-sm">{children}</ul>
    </div>
  );
}

function Item({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-muted hover:text-primary-700 transition-colors"
      >
        {children}
      </Link>
    </li>
  );
}
