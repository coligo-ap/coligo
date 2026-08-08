"use client";

import {
  Eye,
  EyeOff,
  HelpCircle,
  Landmark,
  MessageCircle,
  Wallet,
} from "lucide-react";
import {
  PartnerBackHeader,
  PartnerMenuGroup,
  PartnerMenuRow,
  PartnerStatusChip,
} from "@/components/shared/partner-ui";
import {
  isSupportConfigured,
  openSupportChat,
} from "@/components/support/tawk-chat";
import {
  OWNER_BADGE,
  OWNER_CTX,
} from "@/components/wallet/operator-recharge-strings";
import {
  PayCard,
  PayScreen,
  ownerOf,
  payHref,
  useHideBalance,
  usePayLang,
  usePayWallet,
  type PayBase,
} from "./pay-core";

/**
 * PARAMÈTRES FINANCIERS — le compte Coligo Pay, les réglages d'affichage et
 * les raccourcis argent du rôle. Uniquement des éléments RÉELS (aucun réglage
 * décoratif) : le reste (CCP de versement…) vit là où il se gère déjà.
 */
export function PaySettings({ base }: { base: PayBase }) {
  const { lang, t, dir } = usePayLang();
  const { state } = usePayWallet();
  const { hidden, toggle } = useHideBalance();

  const owner = ownerOf(state);

  return (
    <PayScreen dir={dir}>
      <PartnerBackHeader title={t.settings} href={payHref(base)} />

      {/* Compte Coligo Pay */}
      <PayCard className="p-3.5">
        <div className="flex items-center gap-3">
          <span
            className="rounded-card grid size-10 shrink-0 place-items-center"
            style={{ background: "var(--d-accent)", color: "var(--d-violet)" }}
          >
            <Wallet className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body font-extrabold text-[var(--d-ink)]">
              Coligo Pay · {OWNER_BADGE[lang][owner]}
            </p>
          </div>
          {state && (
            <PartnerStatusChip tone={state.canOperate ? "ok" : "rejected"}>
              {state.canOperate ? t.active : t.blocked}
            </PartnerStatusChip>
          )}
        </div>
        <p className="text-caption-lg mt-2.5 leading-snug font-medium text-[var(--d-muted)]">
          {OWNER_CTX[lang][owner]}
        </p>
      </PayCard>

      {/* Affichage */}
      <div className="mt-3">
        <PartnerMenuGroup>
          <PartnerMenuRow
            icon={
              hidden ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )
            }
            label={t.hideBalance}
            sublabel={t.hideBalanceSub}
            onClick={toggle}
            trailing={
              <span
                role="switch"
                aria-checked={hidden}
                className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors"
                style={{
                  background: hidden ? "var(--d-violet)" : "var(--d-line)",
                }}
              >
                <i
                  className="absolute size-5 rounded-full bg-white shadow transition-all"
                  style={
                    hidden ? { insetInlineStart: 18 } : { insetInlineStart: 2 }
                  }
                />
              </span>
            }
          />
        </PartnerMenuGroup>
      </div>

      {/* Un seul RÉGLAGE financier réel par rôle — aucun raccourci de
          navigation dupliqué (les Gains, Stats, Abonnement ont leurs pages). */}
      {base === "/chauffeur" && (
        <PartnerMenuGroup>
          <PartnerMenuRow
            icon={<Landmark className="size-4" />}
            label={t.ccpPayoutRow}
            sublabel={t.ccpPayoutSub}
            href="/chauffeur/compte"
          />
        </PartnerMenuGroup>
      )}

      {/* Aide */}
      <PartnerMenuGroup title={t.help}>
        <PartnerMenuRow
          icon={<HelpCircle className="size-4" />}
          label={t.howItWorks}
          href={payHref(base, "/methode")}
        />
        {isSupportConfigured() && (
          <PartnerMenuRow
            icon={<MessageCircle className="size-4" />}
            label={t.contactSupport}
            onClick={() =>
              openSupportChat({
                attributes: {
                  sujet: "Coligo Pay",
                  espace: OWNER_BADGE.fr[owner],
                },
              })
            }
          />
        )}
      </PartnerMenuGroup>
    </PayScreen>
  );
}
