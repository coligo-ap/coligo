"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  BarChart3,
  CalendarDays,
  Clock,
  Crosshair,
  Loader2,
  LogOut,
  MapPin,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import { setGlobalAvailability, driverLogout } from "@/app/(driver)/actions";
import { useDriverOnline, setDriverOnline } from "@/lib/driver/online-store";
import { getActiveCourse } from "@/lib/driver/active-course-store";
import { useWorkZone } from "@/lib/driver/work-zone";
import { WorkZoneSheet } from "@/components/driver/home/work-zone-sheet";
import { DriverBalancePill } from "@/components/driver/balance-pill";
import { DriverDarkPill } from "@/components/driver/driver-dark-pill";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { playGo } from "@/lib/driver/sounds";
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
 * Accueil livreur (GO + réception) — version PRO « corrigée » reproduite À
 * L'IDENTIQUE de MAQUETTE-livreur-COMPLETE :
 *  - carte plein écran épurée (chip « ● En ligne » haut-gauche en ligne +
 *    bouton recentrer haut-droite porté par DriverHomeMap) ;
 *  - feuille basse = TÊTE D'INFORMATION : en-tête « Aujourd'hui » + montant du
 *    jour (raccourci vers Gains), 3 métriques EN LIGNE FINE (Courses · En
 *    ligne · Note), statut de recherche (en ligne) / invite (hors ligne) ;
 *  - bouton GO rond COMPACT en dock, à cheval sur le bord supérieur de la
 *    feuille : violet plein hors ligne (anneau interne + « GO »), vert plein +
 *    halo + vagues encerclées en ligne (« EN LIGNE ») ;
 *  - son « mise en ligne » (playGo), AUCUN toast de statut (le bouton + le chip
 *    suffisent).
 * Posé en overlay au-dessus de la vraie carte (MapLibre) ; la tabbar reste
 * persistante en dessous.
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
    // source de vérité du bouton (et du dispatch). La synchro serveur
    // (lente : boucle sur chaque paire commerçant) part en arrière-plan et NE
    // bloque PAS le bouton — qui n'est donc jamais désactivé. Plus de
    // router.refresh() bloquant : passer hors ligne est aussi rapide que
    // passer en ligne.
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
      // Rafraîchit les données serveur (compteurs…) seulement à la mise en
      // ligne, en arrière-plan — inutile et coûteux au passage hors ligne.
      if (next) router.refresh();
    });
  };

  return (
    <>
      {/* Message bloquant « compte gelé » (réaffiché à chaque clic sur GO). */}
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
              className="mq-sora"
              style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}
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
                fontFamily: "var(--font-sora), Sora, sans-serif",
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
          className="mq-sora"
          style={{
            position: "absolute",
            top: "max(58px, calc(env(safe-area-inset-top) + 14px))",
            left: 16,
            right: 16,
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

      {/* Barre du haut : menu (gauche) + statut « ● En ligne » ⟷ solde (droite).
          Toutes les options sont regroupées dans le tiroir → l'accueil reste
          dégagé (style Uber). */}
      <div className="home-topbar">
        <div className="flex items-center gap-2">
          <PartnerMenuButton
            onClick={() => setMenuOpen(true)}
            theme={DRIVER_THEME}
            label={tr("Menu", "القائمة")}
            badge={tourPending}
            className="!size-[42px] !rounded-full"
          />
          {online && !isFrozen && (
            <div className="home-chip">
              <span className="d" />
              {tr("En ligne", "متصل")}
            </div>
          )}
        </div>
        <DriverBalancePill driverId={driverId} />
      </div>

      {/* Feuille d'accueil (tête d'information), posée au-dessus de la tabbar.
          La classe `online` pilote le bouton (vert + radar), le statut de
          recherche et la couleur du bouton via le CSS de la maquette. */}
      <div className={"mq-sheet" + (online ? " online" : "")}>
        {/* Bouton GO en dock (à cheval sur le bord supérieur de la feuille). */}
        <div className="go-cap">
          {online
            ? tr("Appuyez pour vous déconnecter", "اضغط لقطع الاتصال")
            : tr("Appuyez pour passer en ligne", "اضغط للاتصال")}
        </div>
        <div className="go-dock">
          <div className="radar">
            <span />
            <span />
            <span />
          </div>
          <button
            type="button"
            className="go-btn"
            onClick={toggle}
            aria-label={
              online
                ? tr("Se déconnecter", "قطع الاتصال")
                : tr("Passer en ligne", "الاتصال")
            }
          >
            <span className="go-off">GO</span>
            <span className="go-on">{tr("EN LIGNE", "متصل")}</span>
          </button>
        </div>

        {/* Hero du jour : gains + nombre de courses (raccourci vers Gains).
            La note et le temps en ligne ne sont PLUS sur l'accueil (la note est
            réservée au profil). */}
        <Link
          href="/driver/gains"
          className="home-head"
          aria-label={tr("Voir mes gains", "عرض أرباحي")}
        >
          <div className="hh-main">
            <div className="lbl">{tr("Aujourd'hui", "اليوم")}</div>
            <div className="v">
              {grp(earnedToday)} {tr("DA", "دج")}
            </div>
          </div>
          <div className="hh-stat">
            <div className="hh-num">{coursesToday}</div>
            <div className="lbl">
              {isAr ? "توصيلة" : "course" + (coursesToday > 1 ? "s" : "")}
            </div>
          </div>
          <div className="gchev">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </div>
        </Link>

        {/* En ligne : statut de recherche (libellé + barre de balayage). */}
        <div className="statusline">
          <div className="lbl">
            <span className="sp" />
            {tr("Recherche d'une commande à livrer…", "البحث عن طلب للتوصيل…")}
          </div>
          <div className="track" />
        </div>

        {/* Hors ligne : simple ligne d'invite. */}
        <div className="offhint">
          {tr(
            "Passez en ligne pour recevoir des commandes",
            "اتصل لاستقبال الطلبات"
          )}
        </div>
      </div>

      {/* ── Tiroir latéral gauche : toutes les options (unifié avec le chauffeur) ── */}
      <PartnerDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        theme={DRIVER_THEME}
        header={
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span
                className="mq-sora grid size-12 shrink-0 place-items-center rounded-[16px] text-[18px] font-extrabold text-white"
                style={{ background: "var(--violet)" }}
              >
                {(driverName || "L").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <b className="mq-sora truncate text-[15px] font-extrabold text-[var(--ink)]">
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
            {/* Finance : gains du jour + solde portefeuille */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  router.push("/driver/gains");
                }}
                className="flex flex-col gap-0.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3 text-left"
              >
                <span className="text-[11px] font-medium text-[var(--muted)]">
                  {tr("Aujourd'hui", "اليوم")}
                </span>
                <span className="mq-sora text-[17px] leading-none font-extrabold">
                  {grp(earnedToday)} {tr("DA", "دج")}
                </span>
                <span className="mt-0.5 text-[10px] text-[var(--muted)]">
                  {coursesToday}{" "}
                  {isAr ? "توصيلة" : "course" + (coursesToday > 1 ? "s" : "")}
                </span>
              </button>
              <div className="flex flex-col gap-1 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted)]">
                  <Wallet className="size-3.5" />
                  {tr("Portefeuille", "المحفظة")}
                </span>
                <DriverBalancePill driverId={driverId} />
              </div>
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
