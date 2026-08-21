"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CreditCard } from "lucide-react";
import { LinkCardFlow } from "@/components/customer/loyalty/link-card-flow";

/**
 * Écran plein de l'étape fidélité post-inscription. Une seule question, trois
 * gros boutons de MÊME taille (Scanner / Saisir / Passer) — l'étape ne peut
 * jamais retenir l'utilisateur.
 */
export function OnboardingCardStep({
  next,
  prefillCode,
}: {
  next: string;
  prefillCode: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("wallet");
  const done = () => router.replace(next);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <div className="bg-primary-50 text-primary-600 mx-auto flex size-14 items-center justify-center rounded-full">
        <CreditCard className="size-7" />
      </div>
      <h1 className="text-foreground mt-4 text-center text-2xl leading-snug font-black tracking-tight">
        {t("loyLinkTitle")}
      </h1>
      <p className="text-muted mx-auto mt-2 max-w-xs text-center text-sm font-medium">
        {t("loyLinkSubtitle")}
      </p>
      <div className="mt-7">
        <LinkCardFlow
          variant="onboarding"
          prefillCode={prefillCode}
          onSkip={done}
          onFinish={done}
        />
      </div>
    </main>
  );
}
