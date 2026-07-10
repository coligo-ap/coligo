"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Car,
  ChevronRight,
  HandCoins,
  Store,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Rôles partenaires listés dans la bottom sheet « Rejoindre Coligo ».
 * 100 % piloté par ce tableau : ajouter un futur profil = UNE ligne ici,
 * zéro JSX à dupliquer.
 */
type PartnerRole = {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  /** Dégradé de la pastille (classes Tailwind from/to, couleurs de marque). */
  gradient: string;
  href: string;
};

const PARTNER_ROLES: PartnerRole[] = [
  {
    key: "merchant",
    title: "Commerçant",
    desc: "Vendez vos produits et recevez vos commandes en direct.",
    icon: Store,
    gradient: "from-[#5B2EFF] to-[#6C2BD9]",
    href: "/login",
  },
  {
    key: "chauffeur",
    title: "Chauffeur",
    desc: "Transportez des passagers avec Coligo Drive.",
    icon: Car,
    gradient: "from-[#16B364] to-[#0E9F6E]",
    href: "/chauffeur/login",
  },
  {
    key: "driver",
    title: "Livreur",
    desc: "Livrez les commandes et gérez vos tournées.",
    icon: Truck,
    gradient: "from-[#EC4899] to-[#FF2D7A]",
    href: "/driver/login",
  },
  {
    key: "coligo-pay-agent",
    title: "Agent Coligo Pay",
    desc: "Point de recharge : vendez du crédit et gérez votre solde.",
    icon: HandCoins,
    gradient: "from-[#F4B740] to-[#E0922F]",
    href: "/partenaire/login",
  },
];

/**
 * Bouton « Devenir partenaire » (bordure violette de marque, icône 2 personnes)
 * + bottom sheet de sélection du profil partenaire. Remplace les anciens
 * boutons « Je suis commerçant / Je suis chauffeur » du bandeau d'auth.
 */
// `min-h-[44px]` : ce bouton vit dans le bandeau des écrans d'auth, où il est la
// seule cible tactile à côté du logo. Il faisait 30 px de haut.
const DEFAULT_TRIGGER_CLASS =
  "border-primary-600 text-primary-700 hover:bg-primary-600/10 inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-medium transition-colors lg:text-sm";

export function PartnerSheetButton({
  label = "Espaces partenaires",
  className,
}: {
  /** Libellé du bouton (défaut « Espaces partenaires »). */
  label?: string;
  /** Classes du déclencheur — permet d'adapter le bouton à chaque thème
   *  (nav d'auth, header Drive…) sans changer la feuille. */
  className?: string;
} = {}) {
  const [open, setOpen] = useState(false);
  // Le portail n'est dispo qu'après montage côté client (document.body).
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  function close() {
    setOpen(false);
    // Restitue le focus au déclencheur (accessibilité).
    triggerRef.current?.focus();
  }

  // Ouverture : verrou du scroll arrière-plan + Échap pour fermer + focus
  // déplacé dans la feuille.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={className ?? DEFAULT_TRIGGER_CLASS}
      >
        <Users className="size-3.5" />
        {label}
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            className="partner-overlay-in fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
            role="dialog"
            aria-modal
            aria-labelledby="partner-sheet-title"
          >
            <div
              ref={panelRef}
              tabIndex={-1}
              className="partner-sheet-in bg-surface flex w-full max-w-md flex-col overflow-hidden rounded-t-[20px] pb-[env(safe-area-inset-bottom)] shadow-xl outline-none sm:rounded-[20px]"
            >
              {/* Poignée (mobile) */}
              <div className="flex justify-center pt-3 sm:hidden" aria-hidden>
                <span className="bg-border h-1 w-10 rounded-full" />
              </div>

              <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
                <div>
                  <h2
                    id="partner-sheet-title"
                    className="text-foreground font-display text-lg font-bold"
                  >
                    Espaces partenaires
                  </h2>
                  <p className="text-muted mt-0.5 text-sm">
                    Choisissez votre espace partenaire.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="text-muted hover:bg-surface-2 -me-1 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
                  aria-label="Fermer"
                >
                  <X className="size-5" />
                </button>
              </div>

              <ul className="flex flex-col gap-1 p-3">
                {PARTNER_ROLES.map((role) => {
                  const Icon = role.icon;
                  return (
                    <li key={role.key}>
                      <Link
                        href={role.href}
                        onClick={close}
                        className="group hover:bg-surface-2 focus-visible:bg-surface-2 flex items-center gap-3.5 rounded-[14px] p-3 transition-colors outline-none"
                      >
                        <span
                          className={cn(
                            "flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br text-white shadow-sm",
                            role.gradient
                          )}
                        >
                          <Icon className="size-6" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-foreground font-display block text-sm font-bold">
                            {role.title}
                          </span>
                          <span className="text-muted mt-0.5 block text-xs leading-snug">
                            {role.desc}
                          </span>
                        </span>
                        <ChevronRight className="text-subtle size-5 shrink-0 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>,
          // Sort du contexte d'empilement du header (sticky z-30) pour passer
          // AU-DESSUS de la nav du bas (z-30) / l'InstallBanner (z-40). On vise
          // le conteneur client s'il existe (conserve les tokens dark scopés
          // [data-space="client"]), sinon document.body (pages d'auth en clair).
          document.querySelector('[data-space="client"]') ?? document.body
        )}
    </>
  );
}
