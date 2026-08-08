"use client";

import Link from "next/link";
import {
  Banknote,
  ChevronRight,
  CreditCard,
  HelpCircle,
  Landmark,
  MessageCircle,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  BRAND_GO,
  PartnerBackHeader,
  PartnerBadge,
} from "@/components/shared/partner-ui";
import {
  isSupportConfigured,
  openSupportChat,
} from "@/components/support/tawk-chat";
import { OWNER_BADGE } from "@/components/wallet/operator-recharge-strings";
import {
  PayCard,
  PayScreen,
  groupNum,
  ownerOf,
  payHref,
  useHideBalance,
  usePayLang,
  usePayWallet,
  type PayBase,
} from "./pay-core";

/**
 * RECHARGER — étape 1 : choisir SA méthode. Une décision par écran : chaque
 * méthode ouvre ensuite SON flux dédié (Carte / Virement CCP / Espèces).
 */
export function PayMethodChoice({
  base,
  agentsEnabled = true,
}: {
  base: PayBase;
  /** Réseau d'agents Coligo Pay visible ? (drapeau coligo_pay_agents, passé
   *  par la page serveur). false = la méthode « Espèces chez un agent »
   *  disparaît de l'écran (et /especes redirige côté serveur). */
  agentsEnabled?: boolean;
}) {
  const { lang, t, tr, dir } = usePayLang();
  const { state } = usePayWallet();
  const { hidden } = useHideBalance();

  const methods = [
    {
      href: payHref(base, "/carte"),
      Icon: CreditCard,
      title: tr.mCard,
      sub: lang === "ar" ? "دفع فوري وآمن" : "Paiement instantané et sécurisé",
      badge: tr.fast,
      badgeTone: "violet" as const,
    },
    {
      href: payHref(base, "/ccp"),
      Icon: Landmark,
      title: tr.mCcp + " CCP",
      sub:
        lang === "ar"
          ? "تحويل إلى حساب CCP الخاص بـ Coligo"
          : "Virement vers le CCP de Coligo",
      badge: "24h",
      badgeTone: "amber" as const,
    },
    ...(agentsEnabled
      ? [
          {
            href: payHref(base, "/especes"),
            Icon: Banknote,
            title:
              lang === "ar"
                ? "لدى وكيل Coligo Pay"
                : "Chez un agent Coligo Pay",
            sub:
              lang === "ar"
                ? "اشحن نقدًا لدى وكيل قريب"
                : "Rechargez en espèces chez un agent",
            badge: lang === "ar" ? "قريب" : "Proche",
            badgeTone: "ok" as const,
          },
        ]
      : []),
  ];

  return (
    <PayScreen dir={dir}>
      <PartnerBackHeader
        title={tr.rechargeTitle}
        subtitle={t.chooseMethod}
        href={payHref(base)}
        trailing={
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: BRAND_GO }}
          >
            <ShieldCheck className="size-3.5" />
            {t.secure}
          </span>
        }
      />

      <div className="space-y-2.5">
        {methods.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            prefetch
            className="flex w-full items-center gap-3 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5"
          >
            <span
              className="grid size-11 shrink-0 place-items-center rounded-[14px]"
              style={{
                background: "var(--d-accent)",
                color: "var(--d-violet)",
              }}
            >
              <m.Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[14px] font-extrabold text-[var(--d-ink)]">
                  {m.title}
                </span>
                <PartnerBadge tone={m.badgeTone}>{m.badge}</PartnerBadge>
              </span>
              <span className="mt-0.5 block truncate text-[12px] font-medium text-[var(--d-muted)]">
                {m.sub}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-[var(--d-muted)] rtl:rotate-180" />
          </Link>
        ))}
      </div>

      {/* Besoin d'aide ? — guide compact + support, sans pavé de texte */}
      <PayCard className="mt-4 p-3.5">
        <p className="flex items-center gap-2 text-[13px] font-extrabold text-[var(--d-ink)]">
          <HelpCircle className="size-4" style={{ color: "var(--d-violet)" }} />
          {t.needHelp}
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[12.5px] font-bold text-[var(--d-muted)]">
            {t.howItWorks}
          </summary>
          <div className="mt-2 space-y-1.5">
            {(lang === "ar"
              ? [
                  agentsEnabled
                    ? "بطاقة = رصيد فوري · تحويل CCP = تحقق خلال 24س · نقدًا لدى وكيل = فوري"
                    : "بطاقة = رصيد فوري · تحويل CCP = تحقق خلال 24س",
                  "كل عملية مسجّلة وغير قابلة للتعديل — رصيدك محمي ويمكن التحقق منه",
                  "الرصيد يُستعمل تلقائيًا: عمولات، اشتراكات — بدون خطوات إضافية",
                ]
              : [
                  agentsEnabled
                    ? "Carte = crédit instantané · Virement CCP = vérifié sous 24 h · Espèces chez un agent = immédiat"
                    : "Carte = crédit instantané · Virement CCP = vérifié sous 24 h",
                  "Chaque opération est enregistrée et infalsifiable — votre solde est protégé",
                  "Le solde sert automatiquement : commissions, abonnements — zéro étape en plus",
                ]
            ).map((line, i) => (
              <p
                key={i}
                className="text-[12px] leading-snug font-medium text-[var(--d-muted)]"
              >
                • {line}
              </p>
            ))}
          </div>
        </details>
        {isSupportConfigured() && state && (
          <button
            type="button"
            onClick={() =>
              openSupportChat({
                attributes: {
                  sujet: "Coligo Pay — recharge",
                  espace: OWNER_BADGE.fr[ownerOf(state)],
                },
              })
            }
            className="mt-2.5 flex items-center gap-2 text-[12.5px] font-bold"
            style={{ color: "var(--d-violet)" }}
          >
            <MessageCircle className="size-4" />
            {t.contactSupport}
          </button>
        )}
      </PayCard>

      {/* Solde actuel — repère discret, jamais l'info principale de l'écran */}
      {state && (
        <Link
          href={payHref(base)}
          prefetch
          className="mt-3 flex items-center gap-3 rounded-[18px] p-3.5"
          style={{ background: "var(--d-accent)" }}
        >
          <span
            className="grid size-9 place-items-center rounded-[12px] bg-[var(--d-surface)]"
            style={{ color: "var(--d-violet)" }}
          >
            <Wallet className="size-4" />
          </span>
          <span className="flex-1 text-[12.5px] font-bold text-[var(--d-ink)]">
            {t.currentBalance}
          </span>
          <span className="text-[14px] font-extrabold text-[var(--d-ink)]">
            {hidden ? "•••••" : `${groupNum(state.effectiveBalanceDa)} DA`}
          </span>
          <ChevronRight className="size-4 text-[var(--d-muted)] rtl:rotate-180" />
        </Link>
      )}
    </PayScreen>
  );
}
