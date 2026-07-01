"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  CreditCard,
  Check,
  Loader2,
  Star,
  Wallet,
  X,
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
import {
  cancelMyPendingSub,
  getChauffeurFinances,
  getDrivePlansForChauffeur,
  subscribeDrivePlan,
  type ChauffeurFinances,
  type ChauffeurPlan,
} from "@/app/(chauffeur)/actions";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
const PERIOD_LABEL: Record<ChauffeurPlan["billing_period"], string> = {
  day: "jour",
  week: "semaine",
  month: "mois",
};
const pct = (r: number) =>
  `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const fmtDA = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

/**
 * Abonnements Drive — DATA-DRIVEN (mig 0304). Affiche le plan Gratuit + tous les
 * plans ACTIFS créés par le super-admin (prix / période jour-semaine-mois /
 * commission / cashback / avantages / badge). Le chauffeur ne transmet qu'un CODE
 * de plan : prix et durée sont IMPOSÉS par le serveur (aucune altération possible).
 *
 * ⚠️ Paiement carte : SEUL le webhook Chargily fait foi. Le retour ?card=success
 * ne prouve rien — on POLLE jusqu'à voir le plan réellement actif.
 */
export function DSubs() {
  const router = useRouter();
  const search = useSearchParams();
  const [fin, setFin] = useState<ChauffeurFinances | null>(null);
  const [plans, setPlans] = useState<ChauffeurPlan[]>([]);
  const [paying, setPaying] = useState<ChauffeurPlan | null>(null);
  const [step, setStep] = useState<"choice" | "ccp">("choice");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cardReturn, setCardReturn] = useState<
    "checking" | "confirmed" | "failed" | null
  >(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    void getChauffeurFinances().then(setFin);
    void getDrivePlansForChauffeur().then(setPlans);
  };
  useEffect(load, []);

  // Libellé d'un code de plan : titre du plan si connu, sinon table statique/code.
  const labelOf = useMemo(() => {
    const byCode = new Map(plans.map((p) => [p.code, p.title]));
    return (code: string) => byCode.get(code) ?? PLAN_LABEL[code] ?? code;
  }, [plans]);

  // ?card=success → on attend la confirmation serveur (webhook). ?card=failed → échec.
  useEffect(() => {
    const flag = search.get("card");
    if (!flag) return;
    router.replace("/chauffeur/abonnement");
    if (flag === "failed") return setCardReturn("failed");
    if (flag !== "success") return;
    setCardReturn("checking");
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      const f = await getChauffeurFinances();
      if (f) setFin(f);
      if (f && !f.pendingSub && f.plan !== "free") {
        setCardReturn("confirmed");
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (tries >= 15) {
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

  const subErr = (reason?: string) =>
    reason === "paid_plans_disabled" || reason === "plan_inactive"
      ? "Ce plan n'est pas disponible pour le moment."
      : reason === "bad_plan"
        ? "Plan introuvable."
        : (reason ?? "Échec");

  const payCcpDone = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying.code, "ccp");
    setBusy(false);
    if (!res.ok) return setError(subErr(res.error));
    const p = paying;
    setPaying(null);
    setStep("choice");
    setMsg(
      `Reçu CCP transmis · abonnement ${p.title} en vérification (24 h) — il sera activé par l'équipe Coligo.`
    );
    load();
  };

  const payCard = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying.code, "card");
    setBusy(false);
    if (!res.ok || !res.url)
      return setError(subErr(res.error) ?? "Paiement carte indisponible.");
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

  const freePct = pct(fin.freeRate);
  const renewBefore = fin.planPeriodEnd
    ? new Date(
        new Date(fin.planPeriodEnd).getTime() + 5 * 86400_000
      ).toISOString()
    : null;

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
        {plans.length > 0
          ? "Gagnez en visibilité et gardez plus sur chaque course. Changez quand vous voulez."
          : fin.freeRate <= 0
            ? "Au lancement, Coligo Drive est gratuit : 0 % de commission, tout est à vous."
            : "Profitez du plan Gratuit."}
      </p>

      {/* Retour Chargily */}
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
          ✓ Paiement confirmé — abonnement {labelOf(fin.plan)} actif
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
            <b className="text-[var(--d-ink)]">{labelOf(fin.plan)}</b> actif au{" "}
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

      {/* Tentative en attente */}
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
              Reçu CCP {labelOf(fin.pendingSub.plan)} ({fin.pendingSub.amount}{" "}
              DA) en vérification par l&apos;équipe Coligo (24 h).
            </>
          ) : (
            <>
              Paiement carte {labelOf(fin.pendingSub.plan)} (
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

      {/* Plan Gratuit (par défaut) */}
      <PlanCard
        current={fin.plan === "free"}
        title="Gratuit"
        price="0 DA"
        badgeColor={null}
        badgeLabel={null}
        advantages={[
          fin.freeRate <= 0
            ? "0 % de commission — tout est à vous 🎉"
            : `Commission ${freePct} par course`,
        ]}
        onChoose={() =>
          setMsg(
            "Le plan Gratuit redevient actif automatiquement à l'échéance de votre abonnement."
          )
        }
      />

      {/* Plans actifs créés par le super-admin */}
      {plans.map((p) => (
        <PlanCard
          key={p.code}
          current={fin.plan === p.code}
          title={p.title}
          subtitle={p.subtitle}
          price={`${fmtDA(p.price_da)} DA`}
          per={`/ ${PERIOD_LABEL[p.billing_period]}`}
          badgeLabel={p.badge_label}
          badgeColor={p.badge_color}
          priority={p.is_priority}
          advantages={
            p.advantages.length
              ? p.advantages
              : [
                  `Commission ${pct(p.commission_rate)}`,
                  ...(p.cashback_rate > 0
                    ? [`Cashback client ${pct(p.cashback_rate)}`]
                    : []),
                ]
          }
          onChoose={() => {
            setPaying(p);
            setStep("choice");
            setError(null);
          }}
        />
      ))}

      {/* Modale paiement */}
      <Sheet
        open={paying != null}
        onClose={() => {
          setPaying(null);
          setStep("choice");
        }}
      >
        <SheetTitle>
          Payer l&apos;abonnement {paying?.title} ·{" "}
          {paying ? fmtDA(paying.price_da) : 0} DA /{" "}
          {paying ? PERIOD_LABEL[paying.billing_period] : ""}
        </SheetTitle>
        {step === "choice" ? (
          <>
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
    </div>
  );
}

function PlanCard({
  current,
  title,
  subtitle,
  price,
  per,
  badgeLabel,
  badgeColor,
  priority,
  advantages,
  onChoose,
}: {
  current: boolean;
  title: string;
  subtitle?: string | null;
  price: string;
  per?: string;
  badgeLabel?: string | null;
  badgeColor?: string | null;
  priority?: boolean;
  advantages: string[];
  onChoose: () => void;
}) {
  return (
    <div
      className="mb-2.5 rounded-[18px] border-[1.5px] p-3.5"
      style={{
        borderColor: current ? VIOLET : badgeColor || "var(--d-line)",
        background: current ? "var(--d-accent)" : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="drive-sora flex flex-wrap items-center gap-2 text-base font-extrabold">
          {title}
          {priority && <Star className="size-4" style={{ color: "#E8B53C" }} />}
          {badgeLabel && (
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-extrabold text-white"
              style={{ background: badgeColor || VIOLET }}
            >
              {badgeLabel}
            </span>
          )}
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
      {subtitle && (
        <p className="mt-0.5 text-xs text-[var(--d-muted)]">{subtitle}</p>
      )}
      <ul className="mt-2 space-y-1">
        {advantages.map((a, i) => (
          <li
            key={i}
            className="flex items-start gap-1.5 text-xs text-[var(--d-ink)]"
          >
            <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: GO }} />
            {a}
          </li>
        ))}
      </ul>
      {!current && (
        <button
          type="button"
          onClick={onChoose}
          className="drive-sora mt-2.5 h-[42px] w-full rounded-[14px] text-[13px] font-bold"
          style={{
            background: VIOLET,
            color: "#fff",
            boxShadow: `0 10px 22px -10px ${VIOLET}`,
          }}
        >
          Choisir {title}
        </button>
      )}
    </div>
  );
}
