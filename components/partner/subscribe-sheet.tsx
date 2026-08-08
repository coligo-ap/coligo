"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import {
  Check,
  CreditCard,
  HandCoins,
  Landmark,
  Loader2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  VIOLET,
  PrimaryBtn,
  GhostBtn,
  Sheet,
  SheetTitle,
} from "@/components/customer/drive/drive-modals";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";
import { useAgentsVisible } from "@/lib/data/agents-visible-client";

// =============================================================================
// Feuille de souscription PARTAGÉE (Pass Prioritaire + plans Drive) — brief
// « Reste a faire Coligo » §1. Trois étapes :
//  - confirm  : solde Coligo Pay suffisant → récap (dates, avantages, prix
//               total) + bouton « Confirmer l'abonnement » ;
//  - methods  : solde insuffisant → moyens de paiement Coligo Pay. Carte →
//               Chargily direct ; CCP / espèces → page de recharge avec le
//               moyen PRÉ-SÉLECTIONNÉ (?method=…) ;
//  - success  : animation de marque + « Paiement et abonnement validé, bravo ! ».
// Aucun code technique n'atteint l'utilisateur : les parents mappent les
// erreurs serveur en messages clairs avant de les passer en `error`.
// =============================================================================

export type SubscribeStep = "confirm" | "methods" | "success";

export type SubscribeOffer = {
  title: string;
  priceDa: number;
  durationDays: number;
  advantages: string[];
  /** Complément de période (ex. « 1er mois, puis 800 DA/mois »). */
  note?: string | null;
};

const fmtDA = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

export function SubscribeSheet({
  offer,
  step,
  balance,
  busy,
  error,
  rechargeBase,
  onConfirm,
  onCard,
  onClose,
}: {
  /** Offre en cours de souscription — null = feuille fermée. */
  offer: SubscribeOffer | null;
  step: SubscribeStep;
  /** Solde Coligo Pay affiché (le serveur re-vérifie au paiement). */
  balance: number;
  busy: boolean;
  /** Message d'erreur DÉJÀ traduit (jamais un code technique). */
  error: string | null;
  /** Base de la page de recharge (« /chauffeur/recharger » ou « /driver/recharger »). */
  rechargeBase: string;
  onConfirm: () => void;
  onCard: () => void;
  onClose: () => void;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const da = tr("DA", "دج");
  // Kill-switch domaine agents (mig 0449) : réseau masqué ⇒ l'option
  // « Espèces chez un agent » disparaît des moyens de paiement.
  const agentsVisible = useAgentsVisible();

  const fmtDate = (d: Date) =>
    d.toLocaleDateString(isAr ? "ar-DZ" : "fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const start = new Date();
  const end = offer
    ? new Date(Date.now() + offer.durationDays * 86400000)
    : start;

  const inlineErr = error && (
    <p
      className="mt-2 text-center text-xs font-bold"
      style={{ color: "#E5484D" }}
    >
      {error}
    </p>
  );

  return (
    <Sheet open={offer != null} onClose={onClose}>
      {offer &&
        (step === "success" ? (
          <>
            <ColigoCelebration variant="verified" />
            <p className="drive-sora mt-1 text-center text-[17px] font-extrabold text-[var(--d-ink)]">
              {tr(
                "Paiement et abonnement validé, bravo !",
                "تم الدفع وتفعيل الاشتراك — مبروك!"
              )}
            </p>
            <p className="mt-1 text-center text-[12.5px] text-[var(--d-muted)]">
              {isAr
                ? `${offer.title} نشط حتى ${fmtDate(end)}.`
                : `${offer.title} actif jusqu'au ${fmtDate(end)}.`}
            </p>
            <PrimaryBtn onClick={onClose}>{tr("Terminé", "تم")}</PrimaryBtn>
          </>
        ) : step === "confirm" ? (
          <>
            <SheetTitle>
              {tr("Confirmer l'abonnement", "تأكيد الاشتراك")}
            </SheetTitle>
            <div className="mt-1 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <b className="drive-sora text-[15px] text-[var(--d-ink)]">
                  {offer.title}
                </b>
                <b
                  className="drive-sora text-[15px] tabular-nums"
                  style={{ color: VIOLET }}
                >
                  {fmtDA(offer.priceDa)} {da}
                </b>
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--d-muted)]">
                {fmtDate(start)} → {fmtDate(end)}
                {offer.note ? ` · ${offer.note}` : ""}
              </p>
              {offer.advantages.length > 0 && (
                <ul className="mt-2.5 space-y-1.5 text-[12.5px] text-[var(--d-ink)]">
                  {offer.advantages.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check
                        className="mt-0.5 size-4 shrink-0"
                        style={{ color: VIOLET }}
                      />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-2 rounded-[13px] bg-[var(--d-soft)] px-3 py-2.5 text-[12px]">
              <Wallet className="size-4 shrink-0" style={{ color: VIOLET }} />
              <span className="text-[var(--d-muted)]">
                {tr(
                  "Payé avec Coligo Pay — solde après :",
                  "يُدفع من كوليغو باي — الرصيد بعده:"
                )}{" "}
                <b className="text-[var(--d-ink)] tabular-nums">
                  {fmtDA(Math.max(0, balance - offer.priceDa))} {da}
                </b>
              </span>
            </div>
            <PrimaryBtn disabled={busy} onClick={onConfirm}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : null}
              {tr("Confirmer l'abonnement", "تأكيد الاشتراك")}
            </PrimaryBtn>
            {inlineErr}
            <GhostBtn onClick={onClose}>{tr("Annuler", "إلغاء")}</GhostBtn>
          </>
        ) : (
          <>
            <SheetTitle>
              {offer.title} · {fmtDA(offer.priceDa)} {da}
            </SheetTitle>
            <p className="mb-2.5 text-[12.5px] text-[var(--d-muted)]">
              {isAr
                ? `رصيد كوليغو باي (${fmtDA(balance)} دج) لا يغطي هذا العرض — اختر وسيلة دفع:`
                : `Solde Coligo Pay (${fmtDA(balance)} DA) insuffisant — choisissez un moyen de paiement :`}
            </p>
            <MethodRow
              icon={CreditCard}
              title={tr(
                "Carte bancaire · en ligne",
                "بطاقة بنكية · عبر الإنترنت"
              )}
              sub={tr(
                "CIB / Edahabia · activation immédiate",
                "CIB / الذهبية · تفعيل فوري"
              )}
              onClick={onCard}
              busy={busy}
            />
            <MethodRow
              icon={Landmark}
              title={tr("Virement CCP / BaridiMob", "تحويل CCP / بريدي موب")}
              sub={tr(
                "Rechargez Coligo Pay puis confirmez en un tap",
                "عبّئ كوليغو باي ثم أكّد بلمسة"
              )}
              href={`${rechargeBase}/ccp`}
            />
            {agentsVisible && (
              <MethodRow
                icon={HandCoins}
                title={tr("Espèces chez un agent", "نقدًا لدى وكيل")}
                sub={tr(
                  "Points de recharge Coligo Pay près de chez vous",
                  "نقاط تعبئة كوليغو باي قريبة منك"
                )}
                href={`${rechargeBase}/especes`}
              />
            )}
            {inlineErr}
            <GhostBtn onClick={onClose}>{tr("Annuler", "إلغاء")}</GhostBtn>
          </>
        ))}
    </Sheet>
  );
}

/** Ligne « moyen de paiement » — bouton (carte) ou lien (recharge pré-sélectionnée). */
function MethodRow({
  icon: Icon,
  title,
  sub,
  href,
  onClick,
  busy,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  href?: string;
  onClick?: () => void;
  busy?: boolean;
}) {
  const inner = (
    <>
      <span
        className="grid size-[38px] shrink-0 place-items-center rounded-[12px]"
        style={{ background: "var(--d-accent)", color: VIOLET }}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Icon className="size-5" />
        )}
      </span>
      <span>
        {title}
        <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
          {sub}
        </small>
      </span>
    </>
  );
  const cls =
    "mb-2 flex w-full items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3 text-start text-[13.5px] font-bold text-[var(--d-ink)]";
  return href ? (
    <Link href={href} prefetch className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} disabled={busy} className={cls}>
      {inner}
    </button>
  );
}
