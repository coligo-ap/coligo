"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  CreditCard,
  Loader2,
  Wallet,
} from "lucide-react";
import {
  VIOLET,
  GO,
  PrimaryBtn,
  GhostBtn,
  Sheet,
  SheetTitle,
} from "@/components/customer/drive/drive-modals";
import { DNav, PLAN_LABEL } from "./d-ui";
import {
  getChauffeurFinances,
  subscribeDrivePlan,
  type ChauffeurFinances,
} from "@/app/(chauffeur)/actions";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/**
 * Abonnements (maquette s-dsubs + modale paySub) : Gratuit 8 % · Pro 1 500
 * DA/mois 3,5 % · Premium 3 900 DA/mois 0 % + priorité + badge. Paiement
 * CCP/BaridiMob (reçu, vérification 24 h) ou carte (activation immédiate).
 */
export function DSubs() {
  const router = useRouter();
  const [fin, setFin] = useState<ChauffeurFinances | null>(null);
  const [paying, setPaying] = useState<"pro" | "premium" | null>(null);
  const [step, setStep] = useState<"choice" | "ccp">("choice");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => void getChauffeurFinances().then(setFin);
  useEffect(load, []);

  if (!fin) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--d-surface)]">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }

  const payCcpDone = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying, "ccp");
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Échec");
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
    const res = await subscribeDrivePlan(paying, "card");
    setBusy(false);
    if (!res.ok || !res.url) {
      setError(res.error ?? "Paiement carte indisponible.");
      return;
    }
    window.open(res.url, "_blank");
    setPaying(null);
    setStep("choice");
    setMsg(
      "Finalisez le paiement par carte — l'abonnement s'active dès la confirmation."
    );
  };

  const renewBefore = fin.planPeriodEnd
    ? new Date(
        new Date(fin.planPeriodEnd).getTime() + 5 * 86400_000
      ).toISOString()
    : null;

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      <button
        type="button"
        onClick={() => router.push("/chauffeur")}
        className="mb-3 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow"
      >
        <ChevronLeft className="size-5" />
      </button>
      <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
        Mon abonnement
      </h1>
      <p className="mb-3 text-[13px] text-[var(--d-muted)]">
        Gardez plus sur chaque course. Changez quand vous voulez.
      </p>

      {fin.plan !== "free" && fin.planPeriodEnd && (
        <div className="mb-3 flex items-center gap-2.5 rounded-[14px] bg-[var(--d-soft)] px-3.5 py-2.5 text-xs font-semibold text-[var(--d-muted)]">
          <span
            className="grid size-[30px] shrink-0 place-items-center rounded-[9px]"
            style={{ background: "#EEEEFD" }}
          >
            <Calendar className="size-4" style={{ color: VIOLET }} />
          </span>
          <span>
            Actif jusqu&apos;au{" "}
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

      {fin.pendingSub && (
        <p
          className="mb-3 rounded-[13px] px-3 py-2.5 text-xs font-bold"
          style={{ background: "rgba(22,179,100,.12)", color: GO }}
        >
          Paiement {PLAN_LABEL[fin.pendingSub.plan]} ({fin.pendingSub.amount} DA
          · {fin.pendingSub.method === "ccp" ? "CCP" : "carte"}) en vérification
          (24 h).
        </p>
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
          <>
            Commission <b>8 %</b> par course · vous reversez les commissions du
            mois
          </>
        }
        cta="Choisir Gratuit"
        secondary
        onClick={() =>
          setMsg(
            "Le plan Gratuit redevient actif automatiquement à l'échéance de votre abonnement."
          )
        }
      />
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
          setPaying("pro");
          setStep("choice");
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
            <b>0 % de commission</b> + priorité dispatch + badge Premium · vous
            ne devez que l&apos;abonnement
          </>
        }
        cta="Choisir Premium"
        onClick={() => {
          setPaying("premium");
          setStep("choice");
        }}
      />

      {/* Modale paiement abonnement (maquette paySubOv) */}
      <Sheet
        open={paying != null}
        onClose={() => {
          setPaying(null);
          setStep("choice");
        }}
      >
        <SheetTitle>
          Payer l&apos;abonnement {paying ? PLAN_LABEL[paying] : ""} ·{" "}
          {paying === "premium"
            ? fin.premiumFee.toLocaleString("fr-FR")
            : fin.proFee.toLocaleString("fr-FR")}{" "}
          DA/mois
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
                style={{ background: "#EEEEFD", color: VIOLET }}
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
                style={{ background: "#EEEEFD", color: VIOLET }}
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

      <DNav />
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
        background: current ? "#EEEEFD" : undefined,
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
