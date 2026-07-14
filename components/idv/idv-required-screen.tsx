import Link from "next/link";
import { getLocale } from "next-intl/server";
import { ChevronRight, Lock, ShieldCheck } from "lucide-react";
import {
  IdvIllusStyles,
  IllusDocScan,
  IllusSelfie,
  IllusShield,
} from "./idv-illustrations";
import { IdvScope } from "./idv-theme";

// =============================================================================
// IDV — ÉCRAN BLOQUANT « vérification obligatoire ». Rendu À LA PLACE du
// contenu de l'espace (même pattern que DriverBlockedScreen / DFrozen), JAMAIS
// par un `redirect()` : rediriger depuis une page streamée sous `loading.tsx`
// casse l'hydratation en production (erreur React #310 — piège vécu sur ce
// projet). Ici, l'utilisateur voit un écran clair et part vers le parcours
// par un `<Link>` (navigation client, zéro risque).
// =============================================================================

const STEPS = [
  { Illus: IllusDocScan, label: "Scannez votre pièce", labelAr: "امسح وثيقتك" },
  { Illus: IllusSelfie, label: "Selfie rapide", labelAr: "سيلفي سريع" },
  { Illus: IllusShield, label: "Vérification", labelAr: "التحقّق" },
] as const;

export async function IdvRequiredScreen({ route }: { route: string }) {
  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <IdvScope
      className="pt-safe pb-safe mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-6"
      style={{ background: "var(--idv-card)", color: "var(--idv-ink)" }}
    >
      <IdvIllusStyles />

      <div className="flex flex-col items-center text-center">
        <ShieldCheck
          className="size-10"
          style={{ color: "var(--idv-accent)" }}
          aria-hidden
        />
        <h1 className="mt-3 text-xl font-bold tracking-tight">
          {tr("Vérifiez votre identité", "تحقّق من هويتك")}
        </h1>
        <p
          className="mt-1.5 text-sm leading-relaxed"
          style={{ color: "var(--idv-muted)" }}
        >
          {tr(
            "Cette étape est désormais obligatoire pour continuer à utiliser votre compte. Elle prend environ 2 minutes.",
            "هذه الخطوة أصبحت إلزامية لمواصلة استعمال حسابك. تستغرق حوالي دقيقتين."
          )}
        </p>
      </div>

      <div className="mt-6 space-y-2.5">
        {STEPS.map(({ Illus, label, labelAr }, i) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-[16px] p-3"
            style={{
              background: "var(--idv-card)",
              border: "1px solid var(--idv-line)",
            }}
          >
            <Illus size={56} />
            <p className="text-sm font-semibold">
              {i + 1}. {isAr ? labelAr : label}
            </p>
          </div>
        ))}
      </div>

      <Link
        href={route}
        className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-full py-3.5 text-sm font-semibold text-white transition-transform active:scale-[.98]"
        style={{ background: "var(--idv-accent)" }}
      >
        {tr("Commencer la vérification", "بدء التحقّق")}
        <ChevronRight className="size-4 rtl:rotate-180" />
      </Link>

      <p
        className="mt-3 flex items-center justify-center gap-1.5 text-[11px]"
        style={{ color: "var(--idv-muted)" }}
      >
        <Lock className="size-3.5" />
        {tr(
          "Données chiffrées, visibles uniquement par l'équipe Coligo",
          "بيانات مشفّرة، لا يطّلع عليها إلا فريق كوليڨو"
        )}
      </p>
    </IdvScope>
  );
}
