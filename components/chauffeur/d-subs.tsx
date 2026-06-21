"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  CreditCard,
  Loader2,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  VIOLET,
  GO,
  RED,
  PrimaryBtn,
  GhostBtn,
  Sheet,
  SheetTitle,
} from "@/components/customer/drive/drive-modals";
import { PLAN_LABEL } from "./d-ui";
import { Portal } from "@/components/ui/portal";
import {
  cancelMyPendingSub,
  getChauffeurFinances,
  subscribeDrivePlan,
  type ChauffeurFinances,
} from "@/app/(chauffeur)/actions";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/**
 * Abonnements (maquette s-dsubs + modale paySub) : Gratuit 8 % · Pro 1 500
 * DA/mois 3,5 % · Premium 3 900 DA/mois 0 % + priorité + badge. Paiement
 * CCP/BaridiMob (reçu, vérification 24 h) ou carte.
 *
 * ⚠️ Paiement carte : SEUL le webhook Chargily fait foi. Le retour
 * `?card=success` ne prouve rien — on POLLE le serveur jusqu'à voir le plan
 * réellement activé. Une tentative non finalisée s'affiche comme telle
 * (rien d'activé) et peut être annulée.
 */
export function DSubs() {
  const router = useRouter();
  const search = useSearchParams();
  const [fin, setFin] = useState<ChauffeurFinances | null>(null);
  const [paying, setPaying] = useState<"pro" | "premium" | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [step, setStep] = useState<"choice" | "ccp">("choice");
  const [duration, setDuration] = useState<7 | 14 | 30>(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);

  // Engage la souscription Pro (après confirmation si remplacement d'un Premium).
  const proceedPro = () => {
    setConfirmDowngrade(false);
    setUpgrade(false);
    setPaying("pro");
    setStep("choice");
  };
  // Retour Chargily : "checking" tant que le webhook n'a pas confirmé.
  const [cardReturn, setCardReturn] = useState<
    "checking" | "confirmed" | "failed" | null
  >(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => void getChauffeurFinances().then(setFin);
  useEffect(load, []);

  // ?card=success → on NE croit PAS la redirection : on attend que le plan
  // soit actif côté serveur (webhook). ?card=failed → échec affiché.
  useEffect(() => {
    const flag = search.get("card");
    if (!flag) return;
    router.replace("/chauffeur/abonnement");
    if (flag === "failed") {
      setCardReturn("failed");
      return;
    }
    if (flag !== "success") return;
    setCardReturn("checking");
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      const f = await getChauffeurFinances();
      if (f) setFin(f);
      // Confirmé quand plus AUCUN paiement en attente et un plan payant actif.
      if (f && !f.pendingSub && f.plan !== "free") {
        setCardReturn("confirmed");
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (tries >= 15) {
        // ~45 s sans confirmation : on reste honnête (toujours en attente).
        if (pollRef.current) clearInterval(pollRef.current);
        setCardReturn(null);
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fin) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--d-surface)]">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }

  // Traduit le motif d'échec serveur (garde lancement mig 0238 incluse).
  const subErr = (reason?: string) =>
    reason === "paid_plans_disabled"
      ? "Les abonnements payants ne sont pas encore disponibles."
      : (reason ?? "Échec");

  const payCcpDone = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying, "ccp", {
      upgrade,
      durationDays: duration,
    });
    setBusy(false);
    if (!res.ok) {
      setError(subErr(res.error));
      return;
    }
    setPaying(null);
    setStep("choice");
    setMsg(
      `Reçu CCP transmis · abonnement ${PLAN_LABEL[paying]} en vérification (24 h) — il sera activé par l'équipe Coligo.`
    );
    load();
  };

  const payCard = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying, "card", {
      upgrade,
      durationDays: duration,
    });
    setBusy(false);
    if (!res.ok || !res.url) {
      setError(subErr(res.error) ?? "Paiement carte indisponible.");
      return;
    }
    window.open(res.url, "_blank");
    setPaying(null);
    setStep("choice");
    setMsg(
      "Paiement carte en cours — RIEN n'est activé tant que la banque n'a pas confirmé. Cette page se mettra à jour automatiquement."
    );
    load();
  };

  const cancelPending = async () => {
    if (busy) return;
    setBusy(true);
    const res = await cancelMyPendingSub();
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Échec");
    else setMsg("Tentative de paiement annulée — aucun montant n'est dû.");
    load();
  };

  // Commission RÉELLE du plan Gratuit (= vtc_commission_rate, 0 au lancement) —
  // jamais en dur : reflète la config plateforme.
  const freePct = (fin.freeRate * 100).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  });

  const renewBefore = fin.planPeriodEnd
    ? new Date(
        new Date(fin.planPeriodEnd).getTime() + 5 * 86400_000
      ).toISOString()
    : null;

  // Tarif d'une durée = tarif mensuel du plan × facteur (1 mois = ×1).
  const DUR_LABEL: Record<7 | 14 | 30, string> = {
    7: "1 semaine",
    14: "2 semaines",
    30: "1 mois",
  };
  const priceFor = (p: "pro" | "premium", days: 7 | 14 | 30) => {
    const monthly = p === "premium" ? fin.premiumFee : fin.proFee;
    if (days === 7) return Math.max(100, Math.round(monthly * fin.weekFactor));
    if (days === 14)
      return Math.max(100, Math.round(monthly * fin.twoWeekFactor));
    return monthly;
  };

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Retour"
        className="mb-3 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
      >
        <ChevronLeft className="size-5" />
      </button>
      <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
        Mon abonnement
      </h1>
      <p className="mb-3 text-[13px] text-[var(--d-muted)]">
        {fin.paidPlansEnabled
          ? "Gardez plus sur chaque course. Changez quand vous voulez."
          : fin.freeRate <= 0
            ? "Au lancement, Coligo Drive est gratuit : 0 % de commission, tout est à vous."
            : "Au lancement, un seul plan : profitez de la commission réduite."}
      </p>

      {/* Retour Chargily : confirmation RÉELLE (webhook) ou échec. */}
      {cardReturn === "checking" && (
        <p className="mb-3 flex items-center gap-2 rounded-[13px] bg-[var(--d-soft)] px-3 py-2.5 text-xs font-bold">
          <Loader2
            className="size-4 shrink-0 animate-spin"
            style={{ color: VIOLET }}
          />
          Confirmation du paiement par la banque en cours… rien n&apos;est
          activé pour l&apos;instant.
        </p>
      )}
      {cardReturn === "confirmed" && (
        <p
          className="mb-3 rounded-[13px] px-3 py-2.5 text-xs font-bold"
          style={{ background: "rgba(22,179,100,.12)", color: GO }}
        >
          ✓ Paiement confirmé par la banque — abonnement {PLAN_LABEL[fin.plan]}{" "}
          actif
          {fin.planPeriodStart && fin.planPeriodEnd
            ? ` du ${fmtDate(fin.planPeriodStart)} au ${fmtDate(fin.planPeriodEnd)}`
            : ""}
          .
        </p>
      )}
      {cardReturn === "failed" && (
        <p
          className="mb-3 rounded-[13px] px-3 py-2.5 text-xs font-bold"
          style={{ background: "rgba(229,72,77,.1)", color: RED }}
        >
          Paiement refusé ou annulé — aucun montant débité, l&apos;abonnement
          n&apos;a PAS été activé. Vous pouvez réessayer.
        </p>
      )}

      {fin.plan !== "free" && fin.planPeriodEnd && (
        <div className="mb-3 flex items-center gap-2.5 rounded-[14px] bg-[var(--d-soft)] px-3.5 py-2.5 text-xs font-semibold text-[var(--d-muted)]">
          <span
            className="grid size-[30px] shrink-0 place-items-center rounded-[9px]"
            style={{ background: "var(--d-accent)" }}
          >
            <Calendar className="size-4" style={{ color: VIOLET }} />
          </span>
          <span>
            Abonnement{" "}
            <b className="text-[var(--d-ink)]">{PLAN_LABEL[fin.plan]}</b> actif{" "}
            {fin.planPeriodStart && (
              <>
                du{" "}
                <b className="text-[var(--d-ink)]">
                  {fmtDate(fin.planPeriodStart)}
                </b>{" "}
              </>
            )}
            au{" "}
            <b className="text-[var(--d-ink)]">{fmtDate(fin.planPeriodEnd)}</b>{" "}
            · renouvelez avant le{" "}
            <b className="text-[var(--d-ink)]">
              {renewBefore ? fmtDate(renewBefore) : "—"}
            </b>
            , sinon retour automatique au plan{" "}
            <b className="text-[var(--d-ink)]">Gratuit</b>
          </span>
        </div>
      )}

      {/* Tentative en attente : HONNÊTE selon le moyen de paiement. */}
      {fin.pendingSub && cardReturn !== "checking" && (
        <div
          className="mb-3 rounded-[13px] px-3 py-2.5 text-xs font-bold"
          style={
            fin.pendingSub.method === "ccp"
              ? { background: "rgba(22,179,100,.12)", color: GO }
              : { background: "rgba(245,158,11,.13)", color: "#B45309" }
          }
        >
          {fin.pendingSub.method === "ccp" ? (
            <>
              Reçu CCP {PLAN_LABEL[fin.pendingSub.plan]} (
              {fin.pendingSub.amount} DA) en vérification par l&apos;équipe
              Coligo (24 h).
            </>
          ) : (
            <>
              Paiement carte {PLAN_LABEL[fin.pendingSub.plan]} (
              {fin.pendingSub.amount} DA) <b>non finalisé</b> — rien n&apos;est
              activé tant que la banque n&apos;a pas confirmé.
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void cancelPending()}
            className="mt-1.5 flex items-center gap-1 text-[11px] font-extrabold underline"
          >
            <X className="size-3" /> Annuler cette tentative
          </button>
        </div>
      )}
      {msg && (
        <p
          className="mb-3 rounded-[13px] px-3 py-2.5 text-xs font-bold"
          style={{ background: "rgba(22,179,100,.12)", color: GO }}
        >
          {msg}
        </p>
      )}

      {/* Gratuit */}
      <Plan
        current={fin.plan === "free"}
        name="Gratuit"
        price="0 DA"
        desc={
          fin.freeRate <= 0 ? (
            <>
              <b>0 % de commission</b> — tout est à vous au lancement 🎉
            </>
          ) : (
            <>
              Commission <b>{freePct} %</b> par course · vous reversez les
              commissions du mois
            </>
          )
        }
        cta="Choisir Gratuit"
        secondary
        onClick={() =>
          setMsg(
            fin.paidPlansEnabled
              ? "Le plan Gratuit redevient actif automatiquement à l'échéance de votre abonnement."
              : "Vous êtes sur le plan Gratuit — aucune commission au lancement."
          )
        }
      />
      {/* Pro / Premium — MASQUÉS au lancement (drive_paid_plans_enabled).
          Le garde serveur (mig 0238) refuse aussi toute souscription forgée. */}
      {fin.paidPlansEnabled && (
        <>
          {/* Pro */}
          <Plan
            current={fin.plan === "pro"}
            name="💼 Pro"
            price={`${fin.proFee.toLocaleString("fr-FR").replace(/ | /g, " ")} DA`}
            per="/mois"
            desc={
              <>
                Commission réduite à <b>3,5 %</b> · abonnement + commissions
                réduites
              </>
            }
            cta="Choisir Pro"
            secondary
            onClick={() => {
              // Garde-fou designé : un Premium actif serait REMPLACÉ immédiatement.
              if (fin.plan === "premium") {
                setConfirmDowngrade(true);
                return;
              }
              proceedPro();
            }}
          />
          {/* Premium */}
          <Plan
            current={fin.plan === "premium"}
            premium
            name="👑 Premium"
            price={`${fin.premiumFee.toLocaleString("fr-FR").replace(/ | /g, " ")} DA`}
            per="/mois"
            desc={
              <>
                <b>0 % de commission</b> + priorité dispatch + badge Premium ·
                vous ne devez que l&apos;abonnement
                {/* Upgrade prorata (façon Claude) : on ne paie que la différence
                pour les jours restants, même date de renouvellement. */}
                {fin.plan === "pro" && fin.upgradeQuote && (
                  <span
                    className="mt-1.5 flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 font-bold"
                    style={{ background: "var(--d-accent)", color: VIOLET }}
                  >
                    <Zap className="size-3.5 shrink-0" />
                    Passage immédiat : payez seulement la différence —{" "}
                    {fin.upgradeQuote.amountDa.toLocaleString("fr-FR")} DA pour
                    vos {fin.upgradeQuote.daysLeft} jours restants, même date de
                    renouvellement.
                  </span>
                )}
              </>
            }
            cta={
              fin.plan === "pro" && fin.upgradeQuote
                ? `Passer à Premium · ${fin.upgradeQuote.amountDa.toLocaleString("fr-FR")} DA`
                : "Choisir Premium"
            }
            onClick={() => {
              setUpgrade(fin.plan === "pro" && !!fin.upgradeQuote);
              setPaying("premium");
              setStep("choice");
            }}
          />
        </>
      )}

      {/* Modale paiement abonnement (maquette paySubOv) */}
      <Sheet
        open={paying != null}
        onClose={() => {
          setPaying(null);
          setStep("choice");
        }}
      >
        <SheetTitle>
          {upgrade && fin.upgradeQuote ? (
            <>
              Passer à Premium ·{" "}
              {fin.upgradeQuote.amountDa.toLocaleString("fr-FR")} DA (prorata{" "}
              {fin.upgradeQuote.daysLeft} j restants)
            </>
          ) : (
            <>
              Payer l&apos;abonnement {paying ? PLAN_LABEL[paying] : ""} ·{" "}
              {paying ? priceFor(paying, duration).toLocaleString("fr-FR") : 0}{" "}
              DA · {DUR_LABEL[duration]}
            </>
          )}
        </SheetTitle>
        {step === "choice" ? (
          <>
            {/* Durée (pas pour un upgrade : prorata sur la période en cours) */}
            {!upgrade && paying && (
              <div className="mb-3 grid grid-cols-3 gap-2">
                {([7, 14, 30] as const).map((d) => {
                  const on = duration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      className="rounded-[13px] border-[1.5px] p-2.5 text-center transition-colors"
                      style={{
                        borderColor: on ? VIOLET : "var(--d-line)",
                        background: on ? "var(--d-accent)" : "transparent",
                      }}
                    >
                      <span className="block text-[12px] font-bold">
                        {DUR_LABEL[d]}
                      </span>
                      <span
                        className="block text-[13px] font-extrabold"
                        style={{ color: on ? VIOLET : "var(--d-ink)" }}
                      >
                        {priceFor(paying, d).toLocaleString("fr-FR")} DA
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mb-2.5 text-[13px] text-[var(--d-muted)]">
              Choisissez votre moyen de paiement :
            </p>
            <button
              type="button"
              onClick={() => setStep("ccp")}
              className="mb-2 flex w-full items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3 text-left text-[13.5px] font-bold"
            >
              <span
                className="grid size-[38px] shrink-0 place-items-center rounded-[12px]"
                style={{ background: "var(--d-accent)", color: VIOLET }}
              >
                <Wallet className="size-5" />
              </span>
              <span>
                Virement CCP / BaridiMob
                <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
                  Vers le compte de la plateforme
                </small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void payCard()}
              className="mb-1 flex w-full items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3 text-left text-[13.5px] font-bold"
            >
              <span
                className="grid size-[38px] shrink-0 place-items-center rounded-[12px]"
                style={{ background: "var(--d-accent)", color: VIOLET }}
              >
                <CreditCard className="size-5" />
              </span>
              <span>
                Carte bancaire · en ligne
                <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
                  CIB / Edahabia · activation immédiate
                </small>
              </span>
            </button>
          </>
        ) : (
          <>
            <p className="mb-1.5 text-[13px] text-[var(--d-muted)]">
              Effectuez le virement vers le CCP Coligo :
            </p>
            <div
              className="my-2.5 rounded-[15px] border-[1.5px] border-dashed bg-[var(--d-soft)] p-3 text-center"
              style={{ borderColor: VIOLET }}
            >
              <p
                className="drive-sora text-[19px] font-extrabold tracking-[1px]"
                style={{ color: VIOLET }}
              >
                {fin.ccp.number} — clé {fin.ccp.key}
              </p>
              <small className="text-[11px] text-[var(--d-muted)]">
                {fin.ccp.name} · mentionnez votre n° de téléphone en référence
              </small>
            </div>
            <PrimaryBtn disabled={busy} onClick={() => void payCcpDone()}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : null}
              J&apos;ai payé · envoyer le reçu
            </PrimaryBtn>
          </>
        )}
        {error && (
          <p
            className="mt-2 text-center text-xs font-bold"
            style={{ color: "#E5484D" }}
          >
            {error}
          </p>
        )}
        <GhostBtn
          onClick={() => {
            setPaying(null);
            setStep("choice");
          }}
        >
          Annuler
        </GhostBtn>
      </Sheet>

      {/* Confirmation designée — remplacement immédiat d'un Premium actif. */}
      {confirmDowngrade && (
        <Portal>
          <div
            className="fixed inset-0 z-[140] flex flex-col justify-end bg-black/45"
            onClick={() => setConfirmDowngrade(false)}
          >
            <div
              className="drive-jakarta rounded-t-[24px] bg-[var(--d-surface)] p-4 pb-[max(16px,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <b className="drive-sora block text-[16px] font-extrabold">
                Passer en Pro maintenant ?
              </b>
              <p className="mt-1 mb-3 text-[13px] text-[var(--d-muted)]">
                Votre Premium est encore actif : souscrire Pro le remplacera
                immédiatement, sans remboursement des jours restants. À
                l’échéance, retour automatique au plan Gratuit.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDowngrade(false)}
                  className="drive-sora h-12 flex-1 rounded-[14px] border border-[var(--d-line)] text-sm font-bold"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={proceedPro}
                  className="drive-sora h-12 flex-1 rounded-[14px] text-sm font-bold text-white"
                  style={{ background: RED }}
                >
                  Continuer
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

function Plan({
  current,
  premium,
  name,
  price,
  per,
  desc,
  cta,
  secondary,
  onClick,
}: {
  current: boolean;
  premium?: boolean;
  name: string;
  price: string;
  per?: string;
  desc: React.ReactNode;
  cta: string;
  secondary?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="mb-2.5 rounded-[18px] border-[1.5px] p-3.5"
      style={{
        borderColor: current ? VIOLET : premium ? "#E8B53C" : "var(--d-line)",
        background: current ? "var(--d-accent)" : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="drive-sora flex items-center gap-2 text-base font-extrabold">
          {name}
          {current && (
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-extrabold text-white"
              style={{ background: VIOLET }}
            >
              Actuel
            </span>
          )}
        </span>
        <span className="drive-sora text-[15px] font-extrabold">
          {price}
          {per && (
            <small className="text-[11px] font-semibold text-[var(--d-muted)]">
              {per}
            </small>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--d-muted)]">{desc}</p>
      {!current && (
        <button
          type="button"
          onClick={onClick}
          className="drive-sora mt-2.5 h-[42px] w-full rounded-[14px] text-[13px] font-bold"
          style={
            secondary
              ? { background: "var(--d-soft)" }
              : {
                  background: VIOLET,
                  color: "#fff",
                  boxShadow: `0 10px 22px -10px ${VIOLET}`,
                }
          }
        >
          {cta}
        </button>
      )}
    </div>
  );
}
