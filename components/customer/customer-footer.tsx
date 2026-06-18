"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/shared/logo";
import { APP_CONFIG } from "@/lib/config/app-config";

// Client Component : rendu par CustomerChrome (client) → useTranslations, JAMAIS
// getTranslations (réservé aux Server Components — sinon « not supported in
// Client Components » → 500 sur toutes les pages client).
export function CustomerFooter() {
  const t = useTranslations("footer");
  return (
    <footer className="border-border mt-12 hidden border-t bg-white lg:block">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-6 py-10 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <Logo variant="amber" size="md" />
          <p className="text-muted max-w-sm text-sm">{APP_CONFIG.tagline}</p>
          <p className="text-subtle text-xs">
            © {new Date().getFullYear()} {APP_CONFIG.name}.{" "}
            {t("allRightsReserved")}
          </p>
        </div>

        <Column title={t("about")}>
          <Item href="/about">Coligo</Item>
          <Item href="/blog">{t("blog")}</Item>
          <Item href="/login">{t("becomeMerchant")}</Item>
        </Column>

        <Column title={t("help")}>
          <Item href="/aide">{t("helpCenter")}</Item>
          <Item href={`mailto:${APP_CONFIG.contact.supportEmail}`}>
            {t("contactUs")}
          </Item>
        </Column>

        <Column title={t("legal")}>
          <Item href="/cgu">{t("terms")}</Item>
          <Item href="/confidentialite">{t("privacy")}</Item>
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
