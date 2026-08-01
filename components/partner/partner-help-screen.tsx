"use client";

import { ArrowDownToLine, Gift, Send } from "lucide-react";

// =============================================================================
// SOUS-PAGE « COMMENT ÇA MARCHE » — le métier d'agent en 3 étapes.
//
// C'était un accordéon replié au milieu de l'accueil, que personne n'ouvrait.
// Sur sa propre page, le contenu est déplié d'emblée : quelqu'un qui vient ici
// veut justement lire.
// =============================================================================

export function PartnerHelpScreen() {
  return (
    <div className="border-border bg-surface space-y-3 rounded-[16px] border p-4">
      <Step
        n={1}
        icon={<ArrowDownToLine className="size-4" />}
        title="Rechargez votre crédit"
        desc="Approvisionnez votre solde par carte (Chargily) ou par virement/CCP avec preuve."
      />
      <Step
        n={2}
        icon={<Send className="size-4" />}
        title="Revendez aux livreurs & chauffeurs"
        desc="Ils vous paient en espèces, vous leur envoyez le crédit depuis votre solde (avec votre PIN)."
      />
      <Step
        n={3}
        icon={<Gift className="size-4" />}
        title="Coligo vous récompense"
        desc="Vous recevez des bonus selon votre volume. Tout est tracé dans l'historique."
      />
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  desc,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="bg-primary-50 text-primary-600 relative flex size-9 shrink-0 items-center justify-center rounded-full">
        {icon}
        <span className="bg-primary-600 absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white">
          {n}
        </span>
      </span>
      <div>
        <p className="text-foreground text-sm font-semibold">{title}</p>
        <p className="text-muted text-xs">{desc}</p>
      </div>
    </div>
  );
}
