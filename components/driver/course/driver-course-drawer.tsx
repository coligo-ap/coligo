"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { BarChart3, Home, LifeBuoy, User } from "lucide-react";
import {
  PartnerDrawer,
  PartnerMenuButton,
  DrawerSection,
  DrawerRow,
  DrawerDivider,
  type DrawerTheme,
} from "@/components/shared/partner-drawer";
import { DriverDarkPill } from "@/components/driver/driver-dark-pill";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

/**
 * Tiroir de l'ÉCRAN DE COMMANDE (offre + course en cours). Le livreur garde
 * ainsi, PENDANT une course, le même menu que sur l'accueil : accès à ses
 * pages (accueil, gains, compte), à l'aide, au mode sombre et à la langue —
 * sans quitter l'écran de la commande. Bouton hamburger flottant en haut à
 * gauche + tiroir coulissant partagé (PartnerDrawer).
 */
const DRIVER_THEME: DrawerTheme = {
  surface: "var(--surface)",
  line: "var(--line)",
  ink: "var(--ink)",
  muted: "var(--muted)",
  soft: "var(--soft)",
  accent: "var(--violet)",
};

export function DriverCourseDrawer({ onHelp }: { onHelp?: () => void }) {
  const [open, setOpen] = useState(false);
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  return (
    <>
      <div className="absolute top-[max(14px,calc(env(safe-area-inset-top)+10px))] left-3 z-[60]">
        <PartnerMenuButton
          onClick={() => setOpen(true)}
          theme={DRIVER_THEME}
          label={tr("Menu", "القائمة")}
        />
      </div>

      <PartnerDrawer
        open={open}
        onClose={() => setOpen(false)}
        theme={DRIVER_THEME}
        header={
          <div className="pt-1 pb-2">
            <p
              className="text-[17px] font-extrabold text-[var(--ink)]"
              style={{ fontFamily: "var(--font-sora), Sora, sans-serif" }}
            >
              {tr("Menu livreur", "قائمة السائق")}
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-[var(--muted)]">
              {tr("Course en cours", "توصيلة جارية")}
            </p>
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-2">
            <DriverDarkPill />
            <LanguageSwitcher compact />
          </div>
        }
      >
        <DrawerSection title={tr("Navigation", "التنقّل")}>
          <DrawerRow
            icon={<Home className="size-[18px]" />}
            label={tr("Accueil", "الرئيسية")}
            href="/driver"
            onClick={() => setOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<BarChart3 className="size-[18px]" />}
            label={tr("Mes gains", "أرباحي")}
            href="/driver/gains"
            onClick={() => setOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<User className="size-[18px]" />}
            label={tr("Mon compte", "حسابي")}
            href="/driver/parametres"
            onClick={() => setOpen(false)}
          />
        </DrawerSection>

        {onHelp && (
          <DrawerSection title={tr("Besoin d'aide ?", "بحاجة لمساعدة؟")}>
            <DrawerRow
              icon={<LifeBuoy className="size-[18px]" />}
              label={tr("Aide & support", "المساعدة والدعم")}
              sublabel={tr(
                "Un souci sur cette course",
                "مشكلة في هذه التوصيلة"
              )}
              onClick={() => {
                setOpen(false);
                onHelp();
              }}
            />
          </DrawerSection>
        )}
      </PartnerDrawer>
    </>
  );
}
