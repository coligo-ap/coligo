"use client";

import type { Dispatch, SetStateAction } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarClock,
  ChevronLeft,
  Clock,
  CreditCard,
  Globe,
  Loader2,
  Route,
  Snowflake,
  User,
  Users,
  Zap,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { useRoadPath } from "@/lib/drive/use-road-path";
import { AvailabilityNotice } from "@/components/zones/availability-notice";
import { DriveMap, type LatLng } from "./drive-map";
import { PrimaryBtn, ProxModal, GO, ROSE, VIOLET } from "./drive-modals";
import { Leg, OptRow, ZoneBlockNotice } from "./drive-ui";
import { IntlApproxTag } from "@/components/customer/intl-approx";
import type { DriveContext, DriveQuote } from "@/app/(customer)/drive/actions";
import type { Gamme, Pt, Screen } from "./drive-types";

const GAMME_IMG: Record<Gamme, string> = {
  classic: "/drive/gamme-classic.png",
  confort: "/drive/gamme-confort.png",
  moto: "/drive/gamme-moto.png",
};

/**
 * Écran prix / gammes / options / paiement de Coligo Drive — extrait de
 * `DriveView`. Présentationnel pur : tout l'état de tarification, le devis signé
 * et le flux de demande vivent dans `DriveView` et sont passés en props ; ce
 * composant n'orchestre AUCUNE logique de course ni de prix.
 */
export function DrivePriceScreen({
  pickup,
  dest,
  route,
  distanceLabel,
  etaMin,
  quotes,
  quote,
  gamme,
  price,
  offerPrice,
  priceStale,
  boostOn,
  boostAmt,
  femaleOnly,
  prox,
  payMode,
  cardRail,
  intlAvailable,
  welcome,
  ctx,
  zoneBlock,
  zoneJoined,
  requestError,
  submitting,
  schedOpen,
  schedAt,
  schedBusy,
  schedMsg,
  schedDone,
  proxOpen,
  setScreen,
  pickGamme,
  stepPrice,
  setPrice,
  setPayMode,
  setCardRail,
  setBoostOn,
  setBoostAmt,
  setFemaleOnly,
  setProx,
  setProxOpen,
  defBoost,
  submitRequest,
  joinDriveWaitlist,
  setSchedOpen,
  setSchedAt,
  setSchedDone,
  setSchedMsg,
  submitSchedule,
}: {
  pickup: Pt;
  dest: Pt;
  route: { km: number; min: number; path?: LatLng[] } | null;
  distanceLabel: string;
  etaMin: number;
  quotes: Record<Gamme, DriveQuote> | null;
  quote: DriveQuote | null;
  gamme: Gamme;
  price: number;
  offerPrice: number;
  priceStale: boolean;
  boostOn: boolean;
  boostAmt: number;
  femaleOnly: boolean;
  prox: { name: string; phone: string } | null;
  payMode: "cash" | "card" | "coligo_pay";
  /** Rail carte : CIB/EDAHABIA (DA, Chargily) ou internationale (€, Stripe). */
  cardRail: "dzd" | "eur";
  /** Option € proposable pour CE client (jugé serveur) ? */
  intlAvailable: boolean;
  welcome: {
    isNew: boolean;
    anchor: number;
    pay: number;
    save: number;
    code: string | null;
  } | null;
  ctx: DriveContext;
  zoneBlock: string | null;
  zoneJoined: boolean;
  requestError: string | null;
  submitting: boolean;
  schedOpen: boolean;
  schedAt: string;
  schedBusy: boolean;
  schedMsg: string | null;
  schedDone: boolean;
  proxOpen: boolean;
  setScreen: Dispatch<SetStateAction<Screen>>;
  pickGamme: (g: Gamme) => void;
  stepPrice: (dir: 1 | -1) => void;
  setPrice: Dispatch<SetStateAction<number>>;
  setPayMode: Dispatch<SetStateAction<"cash" | "card" | "coligo_pay">>;
  setCardRail: Dispatch<SetStateAction<"dzd" | "eur">>;
  setBoostOn: Dispatch<SetStateAction<boolean>>;
  setBoostAmt: Dispatch<SetStateAction<number>>;
  setFemaleOnly: Dispatch<SetStateAction<boolean>>;
  setProx: Dispatch<SetStateAction<{ name: string; phone: string } | null>>;
  setProxOpen: Dispatch<SetStateAction<boolean>>;
  defBoost: (forPrice: number) => number;
  submitRequest: () => void;
  joinDriveWaitlist: () => void;
  setSchedOpen: Dispatch<SetStateAction<boolean>>;
  setSchedAt: Dispatch<SetStateAction<string>>;
  setSchedDone: Dispatch<SetStateAction<boolean>>;
  setSchedMsg: Dispatch<SetStateAction<string | null>>;
  submitSchedule: () => void;
}) {
  const t = useTranslations("drive");
  const router = useRouter();

  // Itinéraire de SECOURS : si l'estimation de DriveView est arrivée sans
  // géométrie (OSRM en disjoncteur), on re-demande ici le tracé réel (retry
  // après le cooldown ~60 s) → la carte montre la vraie route, pas une ligne
  // droite, dès qu'OSRM répond. Ne double jamais l'appel quand le tracé existe.
  const needPath = !route?.path;
  const backupPath = useRoadPath(
    needPath ? { lat: pickup.lat, lng: pickup.lng } : null,
    needPath ? { lat: dest.lat, lng: dest.lng } : null,
    { retryMs: 65_000 }
  );

  const floorLabel = !quote
    ? null
    : price === quote.mini
      ? t("price.tierMiniHint")
      : price === quote.fast
        ? t("price.tierFastHint")
        : price < quote.recommended
          ? t("price.belowReco", { reco: quote.recommended })
          : price === quote.recommended
            ? t("price.atReco")
            : t("price.aboveReco", { reco: quote.recommended });
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--d-surface)]">
      {/* Carte du trajet (haut d'écran, maquette s-price) */}
      <div className="relative h-[196px] shrink-0 bg-[var(--d-page)]">
        <DriveMap
          markers={[
            { id: "me", pos: pickup, kind: "me", label: "A" },
            { id: "dest", pos: dest, kind: "pin", label: "B" },
          ]}
          route={route?.path ?? backupPath ?? [pickup, dest]}
          padding={{ top: 40, bottom: 30, left: 50, right: 50 }}
          className="absolute inset-0"
        />
        <button
          type="button"
          onClick={() => setScreen("home")}
          className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
          aria-label={t("back")}
        >
          <ChevronLeft className="size-5" />
        </button>
      </div>

      <div className="drive-jakarta -mt-4 flex-1 overflow-y-auto rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-4 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
        {/* Départ / destination (rail pointillé) */}
        <Leg
          label={t("departure")}
          value={
            pickup.gps
              ? `${t("myPosition")}${pickup.text ? ` · ${pickup.text}` : ""}`
              : (pickup.text ?? "—")
          }
          start
        />
        <Leg label={t("destination")} value={dest.text ?? "—"} />

        {/* Offre « Bienvenue » 1ʳᵉ course : ancre barrée + code appliqué.
            Ancrage cosmétique (le client paie le prix réel = ce que touche
            le chauffeur ; coût plateforme nul). Désactivable côté super-admin. */}
        {welcome?.isNew && welcome.save > 0 && (
          <div className="mt-3 flex items-center gap-3 rounded-[16px] border-[1.5px] border-[#FF2D7A]/30 bg-[#FFF0F6] px-3.5 py-2.5">
            <span className="text-[20px]">🎁</span>
            <div className="flex-1">
              <p className="text-[12.5px] font-extrabold text-[#FF2D7A]">
                {t("price.welcomeTitle", { code: welcome.code ?? "" })}
              </p>
              <p className="text-[11px] font-semibold text-[var(--d-muted)]">
                <span className="line-through">{formatDA(welcome.anchor)}</span>{" "}
                → <b>{formatDA(welcome.pay)}</b> ·{" "}
                {t("price.welcomeSave", { save: formatDA(welcome.save) })}
              </p>
            </div>
          </div>
        )}

        {/* Réservation programmée — masquée tant que le super-admin ne l'a pas
            activée (drive_scheduled_enabled). */}
        {ctx.scheduledEnabled && (
          <button
            type="button"
            onClick={() => {
              setSchedDone(false);
              setSchedMsg(null);
              setSchedOpen(true);
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-[var(--d-line)] py-2.5 text-[13px] font-bold"
            style={{ color: "var(--d-violet)" }}
          >
            <CalendarClock className="size-4" />
            {t("price.scheduleCta")}
          </button>
        )}
        {schedOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            onClick={() => !schedBusy && setSchedOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-t-[24px] bg-[var(--d-surface)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-1 text-[15px] font-extrabold">
                {t("price.scheduleTitle")}
              </p>
              <p className="mb-3 text-[12px] text-[var(--d-muted)]">
                {t("price.scheduleHint")}
              </p>
              {schedDone ? (
                <p className="py-4 text-center text-[14px] font-bold text-[var(--d-go,#16A34A)]">
                  {t("price.scheduleOk")}
                </p>
              ) : (
                <>
                  <input
                    type="datetime-local"
                    value={schedAt}
                    min={new Date(
                      Date.now() +
                        (ctx.scheduledLeadMin + 1) * 60_000 -
                        new Date().getTimezoneOffset() * 60_000
                    )
                      .toISOString()
                      .slice(0, 16)}
                    onChange={(e) => setSchedAt(e.target.value)}
                    className="w-full rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-2.5 text-[14px] font-semibold"
                  />
                  {schedMsg && (
                    <p className="mt-2 text-[12px] font-semibold text-[#E5484D]">
                      {schedMsg}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!schedAt || schedBusy}
                    onClick={submitSchedule}
                    className="mt-3 w-full rounded-[14px] py-3 text-[14px] font-extrabold text-white disabled:opacity-50"
                    style={{ background: VIOLET }}
                  >
                    {schedBusy ? "…" : t("price.scheduleConfirm")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        <div className="mt-1 mb-3.5 flex gap-2">
          {/* Affichage INSTANTANÉ : estimation à vol d'oiseau tout de suite,
              affinée en silence par OSRM (jamais de loader d'attente). */}
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--d-soft)] px-3 py-1.5 text-[12.5px] font-bold">
            <Route className="size-3.5" /> {distanceLabel} km
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--d-soft)] px-3 py-1.5 text-[12.5px] font-bold">
            <Clock className="size-3.5" /> ~{etaMin} min
          </span>
        </div>

        {/* Gammes : cards carrées défilables (photos maquette) */}
        <div className="-mx-1 mb-3 flex [scrollbar-width:none] gap-2 overflow-x-auto px-1 pb-1.5">
          {(["classic", "confort", "moto"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => pickGamme(g)}
              className="relative flex w-[108px] shrink-0 flex-col items-center rounded-[18px] border-[1.5px] px-2 pt-3 pb-2.5 text-center"
              style={
                /* Fond TOKENISÉ dans les deux états (jamais #fff en dur : en
                   sombre le texte hérité --d-ink est blanc → invisible). */
                gamme === g
                  ? {
                      borderColor: "var(--d-violet)",
                      background: "var(--d-accent)",
                      boxShadow: "0 8px 20px -10px rgba(91,91,230,.42)",
                    }
                  : {
                      borderColor: "var(--d-line)",
                      background: "var(--d-soft)",
                    }
              }
            >
              {g === "confort" && (
                /* Climatisation incluse dans la gamme Confort */
                <span className="absolute top-1.5 right-1.5 flex size-[22px] items-center justify-center rounded-full bg-[#E3F1FF]">
                  <Snowflake className="size-3.5 text-[#1E88E5]" />
                </span>
              )}
              {g === "moto" && (
                /* Moto : éclair = vitesse, gain de temps dans la circulation */
                <span className="absolute top-1.5 right-1.5 flex size-[22px] items-center justify-center rounded-full bg-[#FFF0E0]">
                  <Zap className="size-3.5 fill-[#F97316] text-[#F97316]" />
                </span>
              )}
              <Image
                src={GAMME_IMG[g]}
                alt={t(`gammes.${g}`)}
                width={88}
                height={62}
                className="pointer-events-none h-[62px] w-[88px] object-contain"
              />
              <b className="drive-sora mt-1 text-[13px]">{t(`gammes.${g}`)}</b>
              <span className="mt-0.5">
                <b className="text-[12px]" style={{ color: "var(--d-violet)" }}>
                  {quotes ? formatDA(quotes[g].recommended) : "…"}
                </b>
                <span className="block text-[9px] font-semibold text-[var(--d-muted)]">
                  {t("price.recommended")}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* Moyen de paiement — choisi ICI (maquette §2.2). Coligo Pay
            affiche le SOLDE ; vide → désactivé ; partiel → accepté, le
            complément se règle en espèces au chauffeur (mig 0163). */}
        <p className="mb-2 text-[13.5px] font-bold">{t("price.payTitle")}</p>
        <div className="mb-3 flex gap-2">
          {(
            [
              ["cash", t("pay.cash")],
              ["card", t("pay.card")],
              ["coligo_pay", "Coligo Pay"],
            ] as const
          ).map(([m, label]) => {
            const cpayEmpty = m === "coligo_pay" && ctx.walletBalance <= 0;
            return (
              <button
                key={m}
                type="button"
                disabled={cpayEmpty}
                onClick={() => setPayMode(m)}
                className="flex-1 rounded-[12px] border-[1.5px] px-1.5 py-2.5 text-[12px] font-bold disabled:opacity-50"
                style={
                  payMode === m
                    ? {
                        borderColor: "var(--d-violet)",
                        background: "var(--d-accent)",
                        color: "var(--d-violet)",
                      }
                    : {
                        borderColor: "var(--d-line)",
                        color: "var(--d-muted)",
                      }
                }
              >
                {label}
                {m === "coligo_pay" && (
                  <span
                    className="block text-[10.5px] font-extrabold"
                    style={cpayEmpty ? { color: "#E5484D" } : { color: GO }}
                  >
                    {formatDA(ctx.walletBalance)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* CARTE : sous-choix du RAIL sur UNE LIGNE — CIB/Edahabia (DA, par
            DÉFAUT) et carte internationale (€). Les deux boutons côte à côte
            n'apparaissent que si l'option € est proposable ; sinon la carte
            reste silencieusement CIB/Edahabia. */}
        {payMode === "card" && intlAvailable && (
          <div className="mb-3 flex gap-2">
            {(
              [
                ["dzd", CreditCard, t("pay.cardDzd"), t("pay.cardDzdSub")],
                ["eur", Globe, t("pay.cardEur"), t("pay.cardEurSub")],
              ] as const
            ).map(([r, Icon, label, sub]) => {
              const on = cardRail === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCardRail(r)}
                  className="flex-1 rounded-[12px] border-[1.5px] px-2.5 py-2 text-start"
                  style={
                    on
                      ? {
                          borderColor: "var(--d-violet)",
                          background: "var(--d-accent)",
                          color: "var(--d-violet)",
                        }
                      : {
                          borderColor: "var(--d-line)",
                          color: "var(--d-muted)",
                        }
                  }
                >
                  <span className="flex items-center gap-1.5">
                    <Icon className="size-3.5 shrink-0" />
                    <b className="text-[12px]">{label}</b>
                  </span>
                  <span
                    className="mt-0.5 block text-[10px] leading-snug font-semibold"
                    style={{ color: "var(--d-muted)" }}
                  >
                    {sub}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Solde Coligo Pay partiel : le complément ira en ESPÈCES au
            chauffeur — ou recharger pour couvrir toute la course. */}
        {payMode === "coligo_pay" && ctx.walletBalance < offerPrice && (
          <div className="mb-3 rounded-[14px] border-[1.5px] border-dashed border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-2.5">
            <p className="text-[12px] leading-relaxed font-semibold">
              {t("price.cpayPartial", {
                wallet: ctx.walletBalance,
                cash: Math.max(0, offerPrice - ctx.walletBalance),
              })}
            </p>
            <button
              type="button"
              onClick={() => router.push("/coligo-pay")}
              className="mt-1.5 text-[12px] font-extrabold underline underline-offset-2"
              style={{ color: "var(--d-violet)" }}
            >
              {t("price.cpayRecharge")}
            </button>
          </div>
        )}

        {/* Votre offre (prix recommandé pré-rempli, ± pas de 20) */}
        <div className="mb-3 rounded-[18px] bg-[var(--d-soft)] p-4 text-center">
          <p className="text-xs font-semibold text-[var(--d-muted)]">
            {t("price.offerLabel")}
          </p>
          {/* Fourchette intelligente : mini / recommandé / rapide (mig 0149) */}
          {quote && (
            <div className="mt-2 flex gap-1.5">
              {(
                [
                  ["mini", quote.mini, t("price.tierMini")],
                  ["reco", quote.recommended, t("price.tierReco")],
                  ["fast", quote.fast, t("price.tierFast")],
                ] as const
              ).map(([k, v, label]) => {
                const on = price === v;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setPrice(v);
                      if (boostOn) setBoostAmt(defBoost(v));
                    }}
                    className="flex flex-1 flex-col items-center rounded-[12px] border-[1.5px] px-1 py-2"
                    style={
                      on
                        ? {
                            borderColor: "var(--d-violet)",
                            background: "var(--d-accent)",
                            color: "var(--d-violet)",
                          }
                        : {
                            borderColor: "var(--d-line)",
                            background: "var(--d-surface)",
                            color: "var(--d-muted)",
                          }
                    }
                  >
                    <span className="text-[10px] font-bold">{label}</span>
                    <b className="drive-sora text-[13px] font-extrabold">
                      {v} DA
                    </b>
                  </button>
                );
              })}
            </div>
          )}
          <div className="my-1.5 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => stepPrice(-1)}
              disabled={priceStale}
              className="grid size-[46px] place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-2xl font-bold disabled:opacity-40"
              style={{ color: "var(--d-violet)" }}
            >
              −
            </button>
            <div
              className="drive-sora flex min-w-[140px] items-center justify-center text-[38px] font-extrabold tracking-[-1.5px]"
              style={boostOn ? { color: GO } : undefined}
            >
              {/* Anti-prix-périmé : pendant le recalcul (adresse changée), on
                  EFFACE l'ancien prix et on montre un loader — jamais un prix
                  qui ne correspond plus au trajet courant. */}
              {priceStale ? (
                <Loader2 className="size-7 animate-spin text-[var(--d-muted)]" />
              ) : (
                <>
                  {offerPrice}{" "}
                  <small className="text-[17px] text-[var(--d-muted)]">
                    DA
                  </small>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => stepPrice(1)}
              disabled={priceStale}
              className="grid size-[46px] place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-2xl font-bold disabled:opacity-40"
              style={{ color: "var(--d-violet)" }}
            >
              +
            </button>
          </div>
          <p className="text-[11.5px] text-[var(--d-muted)]">
            {floorLabel}
            {boostOn && (
              <span className="font-bold" style={{ color: GO }}>
                {" "}
                · ⚡ {t("price.boostIncluded", { amount: boostAmt })}
              </span>
            )}
          </p>
          {quote && quote.high > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1 text-[11px] font-bold text-[var(--d-muted)]">
              {t("price.similar")}{" "}
              <b className="text-[var(--d-ink)]">
                {quote.low}–{quote.high} DA
              </b>
            </p>
          )}
        </div>

        {/* Booster (vert) */}
        <OptRow
          color={GO}
          soft="rgba(22,179,100,.12)"
          icon={<Zap className="size-[18px]" />}
          title={t("boost.title")}
          sub={t("boost.sub")}
          on={boostOn}
          onToggle={() => {
            setBoostOn((b) => {
              if (!b) setBoostAmt(defBoost(price));
              return !b;
            });
          }}
        />
        {boostOn && (
          <div className="flex items-center justify-between py-2 pl-11">
            <span className="text-xs font-semibold text-[var(--d-muted)]">
              {t("boost.amount")}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setBoostAmt((a) => Math.max(ctx.boostMin, a - ctx.boostStep))
                }
                className="grid size-10 place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-xl font-bold"
                style={{ color: "var(--d-violet)" }}
              >
                −
              </button>
              <span className="min-w-[74px] text-center text-[13px] font-semibold text-[var(--d-muted)]">
                <b className="drive-sora text-[20px] text-[var(--d-ink)]">
                  {boostAmt}
                </b>{" "}
                DA
              </span>
              <button
                type="button"
                onClick={() => setBoostAmt((a) => a + ctx.boostStep)}
                className="grid size-10 place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-xl font-bold"
                style={{ color: "var(--d-violet)" }}
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* Femme au volant (rose) — visible pour tous, actif pour les
            clientes au profil vérifié (le serveur ré-applique la règle). */}
        {ctx.femaleFilterEnabled && (
          <OptRow
            color={ROSE}
            soft="rgba(236,72,153,.13)"
            icon={<User className="size-[18px]" />}
            title={t("female.title")}
            sub={
              !ctx.isFemaleVerified
                ? t("female.subLocked")
                : femaleOnly
                  ? t("female.subOn")
                  : t("female.subOff", { count: ctx.femaleOnlineCount })
            }
            on={femaleOnly}
            disabled={!ctx.isFemaleVerified}
            onToggle={() => setFemaleOnly((v) => !v)}
          />
        )}

        {/* Pour un proche */}
        <OptRow
          color="var(--d-ink)"
          soft="var(--d-soft)"
          icon={<Users className="size-[18px]" />}
          title={t("prox.title")}
          sub={prox ? t("prox.subOn", { name: prox.name }) : t("prox.subOff")}
          on={!!prox}
          onToggle={() => {
            if (prox) setProx(null);
            else setProxOpen(true);
          }}
        />

        {requestError && (
          <p
            className="mt-2 rounded-[12px] bg-[rgba(229,72,77,.1)] px-3 py-2 text-center text-xs font-bold"
            style={{ color: "#E5484D" }}
          >
            {requestError}
          </p>
        )}
        {zoneBlock && (
          <ZoneBlockNotice
            message={zoneBlock}
            joined={zoneJoined}
            onJoin={joinDriveWaitlist}
            className="mt-2"
          />
        )}
        {!zoneBlock && pickup && (
          <AvailabilityNotice
            service="drive"
            lat={pickup.lat}
            lng={pickup.lng}
            className="mt-2"
          />
        )}
        <PrimaryBtn
          onClick={submitRequest}
          disabled={submitting || priceStale || !quote || !!zoneBlock}
        >
          {submitting || priceStale ? (
            <Loader2 className="size-5 animate-spin" />
          ) : null}
          {priceStale
            ? t("price.recalculating")
            : t("price.propose", { price: offerPrice })}
          {/* Carte internationale : « ≈ X € » en petit (façon Uber) — le
              client voit AVANT de demander ce que sa carte paiera. */}
          {!priceStale &&
            payMode === "card" &&
            cardRail === "eur" &&
            intlAvailable &&
            offerPrice > 0 && (
              <IntlApproxTag
                totalDa={offerPrice + (boostOn ? boostAmt : 0)}
                className="ms-1.5 text-[12px] font-bold tabular-nums opacity-90"
              />
            )}
        </PrimaryBtn>
      </div>

      <ProxModal
        open={proxOpen}
        onClose={() => setProxOpen(false)}
        onConfirm={(name, phone) => {
          setProx({ name, phone });
          setProxOpen(false);
        }}
      />
    </div>
  );
}
