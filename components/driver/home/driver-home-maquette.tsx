"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  Clock,
  Crosshair,
  Loader2,
  LocateFixed,
  LogOut,
  MapPin,
  Power,
  Radio,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import { setGlobalAvailability, driverLogout } from "@/app/(driver)/actions";
import { useDriverOnline, setDriverOnline } from "@/lib/driver/online-store";
import {
  getActiveCourse,
  useActiveCourse,
} from "@/lib/driver/active-course-store";
import { useWorkZone } from "@/lib/driver/work-zone";
import { WorkZoneSheet } from "@/components/driver/home/work-zone-sheet";
import { DriverBalanceAmount } from "@/components/driver/balance-pill";
import { DriverDarkPill } from "@/components/driver/driver-dark-pill";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { playGo } from "@/lib/driver/sounds";
import { BRAND_GO, SORA } from "@/components/shared/partner-ui";
import {
  PartnerDrawer,
  PartnerMenuButton,
  DrawerSection,
  DrawerRow,
  DrawerDivider,
  type DrawerTheme,
} from "@/components/shared/partner-drawer";

const DRIVER_THEME: DrawerTheme = {
  surface: "var(--surface)",
  line: "var(--line)",
  ink: "var(--ink)",
  muted: "var(--muted)",
  soft: "var(--soft)",
  accent: "var(--violet)",
};

export const FROZEN_MESSAGE =
  "Votre compte est gelé/bloqué. Merci de prendre contact avec le support pour résoudre le problème.";

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Accueil livreur — PARITÉ MAQUETTE ACCUEIL CHAUFFEUR (d-home) :
 *  - bandeau haut épuré : menu (GAUCHE) · revenu du jour en pilule violette
 *    (CENTRE, → Gains) · GPS recentrer (DROITE, événement vers la carte) ;
 *  - barre de mise en ligne dockée en bas (interrupteur « En ligne / Hors
 *    ligne » façon Uber), SEUL contrôle conservé sur l'accueil ;
 *  - tiroir gauche partagé (PartnerDrawer) pour toutes les options.
 * La LOGIQUE est inchangée : bascule optimiste (store = source de vérité du
 * dispatch), gel → refus de mise en ligne + modale, son playGo, logout bloqué
 * en course.
 */
export function DriverHomeMaquette({
  driverId,
  driverName,
  isVerified = false,
  earnedToday,
  coursesToday,
  showToursEntry = false,
  tourPending = 0,
  isFrozen = false,
  freezeReason = null,
}: {
  driverId: string;
  driverName?: string | null;
  isVerified?: boolean;
  earnedToday: number;
  coursesToday: number;
  showToursEntry?: boolean;
  tourPending?: number;
  isFrozen?: boolean;
  freezeReason?: string | null;
}) {
  const online = useDriverOnline();
  const activeCourse = useActiveCourse();
  const [, start] = useTransition();
  const router = useRouter();
  // Bilingue FR/ع (suit la locale racine, comme l'espace chauffeur).
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  // Affiche le message « compte gelé » si le serveur refuse la mise en ligne.
  const [frozenMsg, setFrozenMsg] = useState(false);
  // Tiroir latéral gauche (toutes les options) + sélecteur de zone de travail.
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutErr, setLogoutErr] = useState<string | null>(null);
  const zone = useWorkZone();

  // Déconnexion (depuis le tiroir) : une course en cours BLOQUE (message inline,
  // pas de toast — règle produit). Le serveur revérifie (source de vérité).
  const doLogout = async () => {
    if (loggingOut) return;
    if (getActiveCourse()) {
      setLogoutErr(
        tr(
          "Terminez votre course en cours avant de vous déconnecter.",
          "أكمل رحلتك الحالية قبل تسجيل الخروج."
        )
      );
      return;
    }
    setLoggingOut(true);
    setLogoutErr(null);
    setDriverOnline(false);
    const res = await driverLogout(); // redirige si OK
    if (res?.error) {
      setLoggingOut(false);
      setLogoutErr(res.error);
    }
  };

  const toggle = () => {
    const next = !online;
    // Compte gelé : refus immédiat de la mise en ligne (le passage HORS LIGNE
    // reste toujours permis).
    if (next && isFrozen) {
      setFrozenMsg(true);
      return;
    }
    // Bascule OPTIMISTE et INSTANTANÉE dans les deux sens : le store est la
    // source de vérité du bouton (et du dispatch). La synchro serveur (lente :
    // boucle sur chaque paire commerçant) part en arrière-plan et NE bloque
    // PAS le bouton.
    setDriverOnline(next);
    if (next) void playGo();
    start(async () => {
      const r = await setGlobalAvailability(next ? "available" : "offline");
      // Le serveur a refusé la mise en ligne (gelé entre-temps) → on annule.
      if (next && r?.error === "FROZEN") {
        setDriverOnline(false);
        setFrozenMsg(true);
        return;
      }
      // Compte dévalidé entre-temps par l'équipe Coligo : on repasse hors ligne
      // et on renvoie le livreur à son étape du parcours (le serveur décide).
      if (next && r?.error === "NOT_ACTIVE") {
        setDriverOnline(false);
        router.refresh();
        return;
      }
      // Rafraîchit les données serveur (compteurs…) seulement à la mise en
      // ligne, en arrière-plan — inutile et coûteux au passage hors ligne.
      if (next) router.refresh();
    });
  };

  // Recentrage : la carte persistante (layout) écoute cet événement.
  const recenter = () =>
    window.dispatchEvent(new CustomEvent("coligo:driver-map:recenter"));

  return (
    <>
      {/* Message bloquant « compte gelé » (réaffiché à chaque tentative). */}
      {frozenMsg && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: "rgba(8,9,16,.6)" }}
          onClick={() => setFrozenMsg(false)}
        >
          <div
            className="w-full max-w-sm text-center"
            style={{
              background: "var(--surface)",
              color: "var(--ink)",
              borderRadius: 22,
              padding: "26px 22px",
              boxShadow: "var(--pill-shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 56,
                height: 56,
                margin: "0 auto 14px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--red-soft)",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: 28, height: 28, stroke: "var(--red)" }}
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <h2
              style={{
                fontFamily: SORA,
                fontSize: 19,
                fontWeight: 800,
                marginBottom: 8,
              }}
            >
              {tr("Compte gelé", "حساب مجمّد")}
            </h2>
            <p
              style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}
            >
              {FROZEN_MESSAGE}
            </p>
            {freezeReason && (
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--muted)",
                  marginTop: 8,
                }}
              >
                {tr("Motif :", "السبب:")} {freezeReason}
              </p>
            )}
            <button
              type="button"
              onClick={() => setFrozenMsg(false)}
              style={{
                marginTop: 18,
                width: "100%",
                height: 48,
                border: 0,
                borderRadius: 14,
                background: "var(--violet)",
                color: "#fff",
                fontFamily: SORA,
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              {tr("J'ai compris", "فهمت")}
            </button>
          </div>
        </div>
      )}

      {/* Bandeau « compte gelé » (souple) : accès aux pages OK, activité bloquée. */}
      {isFrozen && (
        <button
          type="button"
          onClick={() => setFrozenMsg(true)}
          style={{
            position: "fixed",
            top: "max(64px, calc(env(safe-area-inset-top) + 62px))",
            left: 12,
            right: 12,
            zIndex: 46,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--red)",
            color: "#fff",
            border: 0,
            borderRadius: 14,
            padding: "10px 14px",
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: SORA,
            boxShadow: "var(--pill-shadow)",
            textAlign: "left",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18, stroke: "#fff", flex: "none" }}
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          {tr(
            "Compte gelé · activité suspendue — appuyez pour en savoir plus",
            "الحساب مجمّد · النشاط موقوف — اضغط لمعرفة المزيد"
          )}
        </button>
      )}

      {/* Bandeau haut épuré (PARITÉ CHAUFFEUR) : menu · revenu du jour · GPS. */}
      <div className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[46] grid grid-cols-3 items-start gap-2">
        {/* GAUCHE — bouton menu (ouvre le tiroir). */}
        <div className="flex justify-start">
          <PartnerMenuButton
            onClick={() => setMenuOpen(true)}
            theme={DRIVER_THEME}
            label={tr("Menu", "القائمة")}
            badge={tourPending}
          />
        </div>

        {/* CENTRE — revenu du jour → ouvre Gains. */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => router.push("/driver/gains")}
            className="flex items-center gap-1.5 rounded-[16px] border py-1.5 pr-2 pl-3.5 text-white shadow-lg"
            style={{ background: "#6C2BD9", borderColor: "#4B1FA6" }}
          >
            <span className="flex flex-col items-start leading-none">
              <span
                className="text-[18px] font-extrabold tracking-[-0.5px]"
                style={{ fontFamily: SORA }}
              >
                {grp(earnedToday)} {tr("DA", "دج")}
              </span>
              <span className="mt-0.5 text-[9px] font-medium whitespace-nowrap opacity-85">
                {tr("Revenu du jour", "دخل اليوم")} · {coursesToday}{" "}
                {isAr ? "توصيلة" : "course" + (coursesToday > 1 ? "s" : "")}
              </span>
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-white/80 rtl:rotate-180" />
          </button>
        </div>

        {/* DROITE — GPS (recentrer, écouté par la carte persistante). */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={recenter}
            aria-label={tr("Centrer sur ma position", "التمركز على موقعي")}
            className="grid size-[44px] place-items-center rounded-[16px] border border-[var(--line)] bg-[var(--surface)] shadow-lg"
          >
            <LocateFixed
              className="size-5"
              style={{ color: "var(--violet)" }}
            />
          </button>
        </div>
      </div>

      {/* ── Barre de mise en ligne dockée (PARITÉ CHAUFFEUR) ──
          Masquée quand une course est active : le bandeau « Course en cours »
          (global) occupe cet emplacement. */}
      {!activeCourse && (
        <div className="fixed inset-x-3 bottom-[78px] z-[46] mx-auto max-w-md">
          <button
            type="button"
            role="switch"
            aria-checked={online}
            aria-label={tr("Disponibilité", "التوفر")}
            onClick={toggle}
            className="flex w-full items-center gap-3 rounded-[20px] border px-4 py-3.5 text-start shadow-xl transition-colors"
            style={{
              borderColor: online ? "rgba(22,179,100,.35)" : "var(--line)",
              background: online ? "rgba(22,179,100,.07)" : "var(--surface)",
            }}
          >
            <span
              className="grid size-11 shrink-0 place-items-center rounded-full transition-colors"
              style={{
                background: online ? "rgba(22,179,100,.16)" : "var(--soft)",
              }}
            >
              {online ? (
                <Radio className="size-5" style={{ color: BRAND_GO }} />
              ) : (
                <Power className="size-5" style={{ color: "var(--muted)" }} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block text-[15.5px] font-extrabold tracking-[-0.2px] text-[var(--ink)]"
                style={{ fontFamily: SORA }}
              >
                {online ? tr("En ligne", "متصل") : tr("Hors ligne", "غير متصل")}
              </span>
              <span className="block truncate text-[12px] text-[var(--muted)]">
                {online
                  ? tr(
                      "En recherche d'une commande à livrer…",
                      "البحث عن طلب للتوصيل…"
                    )
                  : tr(
                      "Activez pour recevoir les commandes",
                      "فعّل لاستقبال الطلبات"
                    )}
              </span>
            </span>
            {/* Switch iOS-like (RTL-safe) */}
            <span
              className="relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors"
              style={{ background: online ? BRAND_GO : "#D6D9E2" }}
            >
              <span
                className="absolute top-[3px] size-[24px] rounded-full bg-white shadow-sm transition-all"
                style={{ insetInlineStart: online ? 25 : 3 }}
              />
            </span>
          </button>
        </div>
      )}

      {/* ── Tiroir latéral gauche : toutes les options (partagé chauffeur) ── */}
      <PartnerDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        theme={DRIVER_THEME}
        header={
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span
                className="grid size-12 shrink-0 place-items-center rounded-[16px] text-[18px] font-extrabold text-white"
                style={{ fontFamily: SORA, background: "var(--violet)" }}
              >
                {(driverName || "L").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <b
                    className="truncate text-[15px] font-extrabold text-[var(--ink)]"
                    style={{ fontFamily: SORA }}
                  >
                    {driverName || tr("Livreur", "موصّل")}
                  </b>
                  {isVerified && (
                    <ShieldCheck
                      className="size-4 shrink-0"
                      style={{ color: "var(--go)" }}
                    />
                  )}
                </div>
                <span className="block truncate text-[12px] text-[var(--muted)]">
                  {tr("Livreur Coligo", "موصّل كوليغو")}
                </span>
              </div>
            </div>
            {/* Finance : gains du jour + solde portefeuille — DEUX cartes au
                format STRICTEMENT identique (label · montant · sous-label). */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  router.push("/driver/gains");
                }}
                className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3 text-left"
              >
                <span className="text-[11px] font-medium text-[var(--muted)]">
                  {tr("Aujourd'hui", "اليوم")}
                </span>
                <span
                  className="truncate text-[17px] leading-none font-extrabold text-[var(--ink)]"
                  style={{ fontFamily: SORA }}
                >
                  {grp(earnedToday)} {tr("DA", "دج")}
                </span>
                <span className="mt-0.5 truncate text-[10px] text-[var(--muted)]">
                  {coursesToday}{" "}
                  {isAr ? "توصيلة" : "course" + (coursesToday > 1 ? "s" : "")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  router.push("/driver/recharger");
                }}
                className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3 text-left"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted)]">
                  <Wallet className="size-3.5" />
                  {tr("Portefeuille", "المحفظة")}
                </span>
                <span
                  className="truncate text-[17px] leading-none font-extrabold text-[var(--ink)]"
                  style={{ fontFamily: SORA }}
                >
                  <DriverBalanceAmount driverId={driverId} />
                </span>
                <span className="mt-0.5 truncate text-[10px] text-[var(--muted)]">
                  Coligo Pay
                </span>
              </button>
            </div>
          </div>
        }
        footer={
          <div className="space-y-2">
            {logoutErr && (
              <p
                className="rounded-[12px] px-3 py-2 text-center text-[12px] font-bold"
                style={{ background: "var(--red-soft)", color: "var(--red)" }}
              >
                {logoutErr}
              </p>
            )}
            <button
              type="button"
              onClick={() => void doLogout()}
              disabled={loggingOut}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border py-3 text-[13.5px] font-bold"
              style={{ borderColor: "var(--red-soft)", color: "var(--red)" }}
            >
              {loggingOut ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              {tr("Se déconnecter", "تسجيل الخروج")}
            </button>
          </div>
        }
      >
        {/* Travail : zone + tournées */}
        <DrawerSection title={tr("Mon travail", "عملي")}>
          <DrawerRow
            icon={
              zone ? (
                <MapPin className="size-4" />
              ) : (
                <Crosshair className="size-4" />
              )
            }
            label={tr("Ma zone de travail", "منطقة عملي")}
            sublabel={
              zone
                ? `${tr("Zone", "منطقة")} · ${zone.radiusKm} km`
                : tr("Autour de moi (GPS)", "حولي (GPS)")
            }
            onClick={() => {
              setMenuOpen(false);
              setZoneOpen(true);
            }}
          />
          {showToursEntry && (
            <>
              <DrawerDivider />
              <DrawerRow
                icon={<CalendarDays className="size-4" />}
                label={tr("Mes tournées", "جولاتي")}
                sublabel={
                  tourPending > 0
                    ? tr(
                        `${tourPending} en attente`,
                        `${tourPending} قيد الانتظار`
                      )
                    : tr("Planning & livraisons", "الجدول والتوصيلات")
                }
                href="/driver/tournees"
                onClick={() => setMenuOpen(false)}
                trailing={
                  tourPending > 0 ? (
                    <span className="grid size-6 place-items-center rounded-full bg-[var(--violet)] text-[11px] font-extrabold text-white">
                      {tourPending}
                    </span>
                  ) : undefined
                }
              />
            </>
          )}
        </DrawerSection>

        {/* Activité & compte */}
        <DrawerSection title={tr("Mon activité", "نشاطي")}>
          <DrawerRow
            icon={<Bell className="size-4" />}
            label={tr("Notifications", "الإشعارات")}
            sublabel={tr("Messages de l'équipe Coligo", "رسائل فريق كوليغو")}
            href="/driver/notifications"
            onClick={() => setMenuOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<BarChart3 className="size-4" />}
            label={tr("Mes gains", "أرباحي")}
            href="/driver/gains"
            onClick={() => setMenuOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<Clock className="size-4" />}
            label={tr("Historique", "السجل")}
            href="/driver/historique"
            onClick={() => setMenuOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<Wallet className="size-4" />}
            label={tr("Coligo Pay", "كوليغو باي")}
            href="/driver/recharger"
            onClick={() => setMenuOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<User className="size-4" />}
            label={tr("Mon compte", "حسابي")}
            href="/driver/parametres"
            onClick={() => setMenuOpen(false)}
          />
        </DrawerSection>

        {/* Apparence & langue */}
        <DrawerSection title={tr("Apparence & langue", "المظهر واللغة")}>
          <div className="flex items-center justify-between gap-3 px-3.5 py-3">
            <span className="text-[13px] font-semibold text-[var(--ink)]">
              {tr("Thème & langue", "السمة واللغة")}
            </span>
            <div className="flex items-center gap-2">
              <LanguageSwitcher compact />
              <DriverDarkPill />
            </div>
          </div>
        </DrawerSection>
      </PartnerDrawer>

      <WorkZoneSheet open={zoneOpen} onClose={() => setZoneOpen(false)} />
    </>
  );
}
