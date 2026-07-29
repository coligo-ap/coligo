"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowUpDown,
  Car,
  Clock,
  History,
  Pencil,
  ShieldAlert,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { getPosition } from "@/lib/native/geolocation";
import { reverseGeocode } from "@/app/(customer)/actions";
import {
  setSosContacts as saveSosContacts,
  type DriveContext,
} from "@/app/(customer)/drive/actions";
import type { DriveIntentDraft } from "@/app/(customer)/drive/ai-actions";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { DriveMap, type LatLng } from "./drive-map";
import {
  DepModal,
  PrimaryBtn,
  SosContactsSheet,
  ROSE,
  VIOLET,
  type SosContact,
} from "./drive-modals";
import { ZoneBlockNotice } from "./drive-ui";
import { DriveAiBar } from "./drive-ai-bar";
import { ThemeDecor } from "@/components/shared/theme-decor";
import type { Pt, Screen } from "./drive-types";

/**
 * Écran d'accueil Coligo Drive (choix du trajet) — extrait de `DriveView`.
 * Présentationnel pur : tout l'état (trajet, zone, contexte) et les handlers
 * qui alimentent le flux de demande vivent dans `DriveView` et sont passés en
 * props. Le composant ne détient AUCUNE logique de course.
 */
export function DriveHomeScreen({
  ctx,
  pickup,
  dest,
  zoneBlock,
  zoneJoined,
  isDesktop,
  routePath,
  aiConfirming,
  depOpen,
  contactsOpen,
  sosContacts,
  setPickup,
  setDest,
  setScreen,
  setMapPickFor,
  setAiConfirming,
  setDepOpen,
  setContactsOpen,
  setSosContactsState,
  swapPoints,
  joinDriveWaitlist,
  applyAiDraft,
}: {
  ctx: DriveContext;
  pickup: Pt | null;
  dest: Pt | null;
  zoneBlock: string | null;
  zoneJoined: boolean;
  isDesktop: boolean;
  /** Tracé routier RÉEL (OSRM) du trajet A→B — jamais une ligne droite. */
  routePath: LatLng[] | null;
  aiConfirming: boolean;
  depOpen: boolean;
  contactsOpen: boolean;
  sosContacts: SosContact[];
  setPickup: Dispatch<SetStateAction<Pt | null>>;
  setDest: Dispatch<SetStateAction<Pt | null>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setMapPickFor: Dispatch<SetStateAction<"dep" | "dest">>;
  setAiConfirming: Dispatch<SetStateAction<boolean>>;
  setDepOpen: Dispatch<SetStateAction<boolean>>;
  setContactsOpen: Dispatch<SetStateAction<boolean>>;
  setSosContactsState: Dispatch<SetStateAction<SosContact[]>>;
  swapPoints: () => void;
  joinDriveWaitlist: () => void;
  applyAiDraft: (d: DriveIntentDraft) => void;
}) {
  const t = useTranslations("drive");
  const router = useRouter();

  return (
    <div className="drive-jakarta drive-screen z-40 flex min-h-[100dvh] flex-col bg-white">
      {/* HÉRO au thème « occasion » (vars posées sur <html>, mig 0415/0416) —
          MÊME langage que l'accueil marketplace / Compte / portefeuilles. PLUS
          DE CARTE EN FOND : l'écran s'ouvre instantanément, MapLibre n'est
          initialisé que sur les écrans choix-sur-carte / prix / course. */}
      <div
        className="relative overflow-hidden rounded-b-[28px] pb-14 text-white"
        style={{
          backgroundImage:
            "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
        }}
      >
        <ThemeDecor />
        <header className="relative z-10 px-5 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2">
            <p className="drive-sora flex items-center gap-1.5 text-[13.5px] font-extrabold tracking-[0.5px] uppercase drop-shadow-sm">
              <Car className="size-[18px]" /> Coligo Drive
            </p>
            <div className="flex items-center gap-1.5">
              {/* <Link> PRÉFETCHÉ (règle « nav client ultra rapide ») : la route
                  + son loading.tsx sont déjà en cache au tap → écran instantané.
                  Un router.push sur onClick ne préfetche rien : premier tap =
                  aller-retour serveur complet, ressenti « le bouton bugue ». */}
              <Link
                href="/drive/historique"
                prefetch
                className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white"
              >
                <History className="size-3.5" /> {t("history")}
              </Link>
              <button
                type="button"
                onClick={() => setContactsOpen(true)}
                aria-label={t("sosContacts.title")}
                className="grid size-9 place-items-center rounded-full border border-white/25 bg-white/15 text-white"
              >
                <ShieldAlert className="size-4" />
              </button>
            </div>
          </div>
        </header>
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5">
          <h1 className="drive-sora mt-3 text-[27px] leading-tight font-extrabold tracking-[-0.6px] drop-shadow-sm">
            {t("home.title")}
          </h1>
        </div>
      </div>

      {/* Contenu — CHEVAUCHE le bas du héro (feuille, signature du design).
          Mobile : 1 colonne ; desktop : formulaire À GAUCHE + carte À DROITE. */}
      <main className="relative z-10 -mt-10 flex-1 overflow-y-auto px-5 pb-24">
        <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,480px)_1fr]">
          <div className="min-w-0">
            {/* Assistant IA : réserver en langage naturel (darija / ar / fr) —
                pilule FLOTTANTE sur le dégradé, écho de la recherche accueil.
                Interrupteur super-admin (Config Drive, mig 0420) : masquée si
                désactivée — les actions serveur refusent aussi (bypass-proof). */}
            {ctx.aiEnabled && (
              <div className="rounded-[18px] shadow-[0_14px_34px_-14px_rgba(0,0,0,0.45)]">
                <DriveAiBar
                  pickup={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
                  onResolved={applyAiDraft}
                  onConfirmingChange={setAiConfirming}
                />
              </div>
            )}

            {!aiConfirming && (
              <>
                {/* Carte formulaire de trajet (départ / arrivée). */}
                <div className="mt-3 rounded-[24px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4 shadow-[0_18px_44px_-30px_rgba(20,22,40,.5)]">
                  <div className="mb-2.5 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setDepOpen(true)}
                        className="flex w-full items-center gap-3 rounded-[15px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
                      >
                        <span
                          className="size-3 shrink-0 rounded-full"
                          style={{ background: VIOLET }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10.5px] font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
                            {t("departure")}
                          </span>
                          <span className="block truncate text-[14.5px] font-bold">
                            {pickup?.gps
                              ? t("myPosition")
                              : (pickup?.text ?? t("home.locating"))}
                          </span>
                          {/* Nom du lieu résolu (reverse geocode) : le client voit que
                    le départ correspond bien à l'endroit où il se trouve. */}
                          {pickup?.gps && (
                            <span className="block truncate text-[11.5px] font-medium text-[var(--d-muted)]">
                              {pickup.text ?? t("home.locating")}
                            </span>
                          )}
                        </span>
                        {pickup?.gps && (
                          <span
                            className="flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-bold"
                            style={{
                              background: "var(--d-accent)",
                              color: VIOLET,
                            }}
                          >
                            GPS
                          </span>
                        )}
                      </button>

                      {/* Connecteur pointillé A→B (langage visuel Bolt). */}
                      <span
                        aria-hidden
                        className="ms-[19px] block h-3.5 w-0 border-s-2 border-dashed border-[var(--d-line)]"
                      />

                      <button
                        type="button"
                        onClick={() => {
                          setMapPickFor("dest");
                          setScreen("mappick");
                        }}
                        className="flex w-full items-center gap-3 rounded-[15px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
                      >
                        <span className="size-3 shrink-0 rounded-[3px] bg-[var(--d-ink)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10.5px] font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
                            {t("destination")}
                          </span>
                          <span
                            className={cn(
                              "block truncate text-[14.5px] font-bold",
                              !dest && "font-semibold text-[var(--d-muted)]"
                            )}
                          >
                            {dest?.text ?? t("home.whereTo")}
                          </span>
                        </span>
                        <Pencil className="size-4 shrink-0 text-[var(--d-muted)]" />
                      </button>
                    </div>
                    {/* Inverser départ ↔ arrivée */}
                    <button
                      type="button"
                      onClick={swapPoints}
                      disabled={!pickup && !dest}
                      aria-label={t("swap")}
                      title={t("swap")}
                      className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] shadow-sm disabled:opacity-40"
                      style={{ color: VIOLET }}
                    >
                      <ArrowUpDown className="size-[18px]" />
                    </button>
                  </div>

                  {/* Zone indisponible (commune/wilaya/rayon bloqués) : message clair +
            « Prévenez-moi » AVANT le choix du prix, et « Continuer » bloqué. */}
                  {pickup && dest && zoneBlock && (
                    <ZoneBlockNotice
                      message={zoneBlock}
                      joined={zoneJoined}
                      onJoin={joinDriveWaitlist}
                      className="mt-1 mb-1"
                    />
                  )}
                  <PrimaryBtn
                    onClick={() => setScreen("price")}
                    disabled={!pickup || !dest || !!zoneBlock}
                    className="!mt-1"
                  >
                    {t("home.continue")}
                  </PrimaryBtn>
                </div>

                {/* Destinations récentes */}
                <div className="mt-3">
                  {ctx.recents.map((r) => (
                    <button
                      key={r.text}
                      type="button"
                      onClick={() =>
                        setDest({ lat: r.lat, lng: r.lng, text: r.text })
                      }
                      className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-0.5 py-2.5 text-left text-[13.5px] font-semibold last:border-b-0"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
                        <Clock className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.text}</span>
                    </button>
                  ))}
                  {ctx.lastRide && (
                    <div className="flex w-full items-center gap-3 px-0.5 py-2.5 text-left text-[13.5px] font-semibold">
                      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
                        <Car className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {ctx.lastRide.dest_text ?? "—"}
                        </span>
                        <small className="block text-[11px] font-medium text-[var(--d-muted)]">
                          {[
                            ctx.lastRide.chauffeur_name,
                            ctx.lastRide.price_da
                              ? formatDA(ctx.lastRide.price_da)
                              : null,
                            ctx.lastRide.completed
                              ? t("status.completed")
                              : t("status.cancelled"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </div>
                  )}
                </div>

                {/* Espace chauffeur — entrée discrète, sans carte. */}
                <button
                  type="button"
                  onClick={() => router.push("/chauffeur")}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] py-3 text-[13.5px] font-bold"
                >
                  <Car className="size-4" style={{ color: VIOLET }} />
                  {t("home.imDriver")}
                </button>
              </>
            )}
          </div>

          {/* Colonne carte (desktop uniquement) — visualisation du trajet A→B,
              se met à jour dès qu'un départ/arrivée est choisi. */}
          {isDesktop && (
            <div className="hidden lg:block">
              <div className="sticky top-4 h-[calc(100dvh-150px)] overflow-hidden rounded-[24px] border border-[var(--d-line)]">
                <DriveMap
                  markers={[
                    ...(pickup
                      ? [
                          {
                            id: "me",
                            pos: pickup,
                            kind: "me" as const,
                            label: "A" as const,
                          },
                        ]
                      : []),
                    ...(dest
                      ? [
                          {
                            id: "dest",
                            pos: dest,
                            kind: "pin" as const,
                            label: "B" as const,
                          },
                        ]
                      : []),
                  ]}
                  route={pickup && dest ? (routePath ?? [pickup, dest]) : null}
                  padding={{ top: 60, bottom: 60, left: 60, right: 60 }}
                  className="absolute inset-0"
                />
              </div>
            </div>
          )}
        </div>
      </main>

      <CustomerBottomNav />
      <DepModal
        open={depOpen}
        onClose={() => setDepOpen(false)}
        onGps={async () => {
          setDepOpen(false);
          try {
            const p = await getPosition({
              enableHighAccuracy: true,
              timeout: 8_000,
              maximumAge: 30_000,
            });
            const r = await reverseGeocode({
              latitude: p.latitude,
              longitude: p.longitude,
              precise: true,
            });
            setPickup({
              lat: p.latitude,
              lng: p.longitude,
              text: r?.display ?? null,
              gps: true,
            });
          } catch {
            /* ignore */
          }
        }}
        onMap={() => {
          setDepOpen(false);
          setMapPickFor("dep");
          setScreen("mappick");
        }}
      />
      <SosContactsSheet
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        contacts={sosContacts}
        onSave={async (next) => {
          const res = await saveSosContacts(next);
          if (res.ok) setSosContactsState(next);
          return res;
        }}
      />
    </div>
  );
}
