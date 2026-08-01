"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/shared/logo";
import { cn } from "@/lib/utils";

/**
 * EN-TÊTE DU PARCOURS INVITÉ (lien /p/{token} et /payer/{ptoken}).
 *
 * Un invité n'a pas de compte : il n'a donc ni la coque client ni la barre de
 * navigation du bas. Sans repère, il se retrouvait sur une page de paiement
 * « nue », sans savoir où il est ni comment revenir. Cette barre fine règle
 * les deux : la marque est visible en permanence (et cliquable — c'est aussi
 * la porte d'entrée vers l'app pour quelqu'un qui ne la connaît pas encore),
 * et la pastille « Invité » dit clairement dans quel rôle il se trouve.
 *
 * Sobre par construction : elle ne doit jamais concurrencer l'en-tête coloré
 * de la room ni la carte de paiement.
 *
 * Zone sûre : le fond se prolonge SOUS la barre de statut (règle safe-area).
 */
export function GuestHeader({
  /** Fond translucide sur un en-tête coloré (room) plutôt qu'opaque. */
  tone = "surface",
  /** `false` quand la page a DÉJÀ un en-tête collant (catalogue) : deux
   *  barres collées au même bord se chevaucheraient. */
  sticky = true,
  className,
}: {
  tone?: "surface" | "onColor";
  sticky?: boolean;
  className?: string;
}) {
  const t = useTranslations("sharedCart");
  const onColor = tone === "onColor";

  return (
    <div
      className={cn(
        "z-30 pt-[env(safe-area-inset-top)]",
        sticky && "sticky top-0",
        onColor
          ? "bg-primary-700/95 backdrop-blur"
          : "bg-surface border-border border-b",
        className
      )}
    >
      <div className="mx-auto flex h-12 max-w-lg items-center justify-between gap-3 px-4">
        <Link
          href="/"
          aria-label="Coligo"
          className="flex min-w-0 items-center transition active:scale-[0.98]"
        >
          <Logo size="sm" iconOnly={onColor} />
        </Link>
        <span
          className={cn(
            "inline-flex min-w-0 shrink items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold",
            onColor
              ? "bg-white/15 text-white"
              : "bg-primary-50 text-primary-700"
          )}
        >
          <UserRound className="size-3.5 shrink-0" />
          <span className="truncate">{t("guestBadge")}</span>
        </span>
      </div>
    </div>
  );
}
