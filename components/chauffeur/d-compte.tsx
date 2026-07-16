"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { setLocale } from "@/i18n/actions";
import { LocaleFlag } from "@/components/i18n/locale-flag";
import {
  BadgeCheck,
  Car,
  ChevronRight,
  Clock,
  CreditCard,
  FileCheck,
  Globe,
  Home,
  Loader2,
  Moon,
  Pencil,
  ShieldAlert,
  Smartphone,
  Sun,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from "lucide-react";
import {
  toggleChauffeurSound,
  useChauffeurSound,
} from "@/lib/chauffeur/sound-store";
import { formatDA } from "@/lib/utils";
import { setTheme } from "@/lib/theme/actions";
import { reverseGeocode } from "@/lib/geo/geocode";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import type { LatLng } from "@/components/customer/drive/drive-map";
import {
  SosContactsSheet,
  GO,
  VIOLET,
  type SosContact,
} from "@/components/customer/drive/drive-modals";
import { ChAvatar } from "@/components/customer/drive/ch-avatar";
import { DriverBadgePill } from "@/components/drive/driver-badge";
import { getDriverBadge } from "@/lib/drive/driver-badge";
import { PLAN_LABEL, PLAN_LABEL_AR, fmtPct } from "./d-ui";
import { Portal } from "@/components/ui/portal";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import {
  PartnerLogoutRow,
  PartnerMenuGroup,
  PartnerMenuRow,
  PartnerStatusChip,
} from "@/components/shared/partner-ui";
import {
  chauffeurLogout,
  getChauffeurFinances,
  getChauffeurSosContacts,
  setChauffeurCcp,
  setChauffeurSosContacts,
  setChauffeurHome,
  type ChauffeurFinances,
  type ChauffeurGate,
} from "@/app/(chauffeur)/actions";
import { setChauffeurOnlineLocal } from "@/lib/chauffeur/online-store";

/** Compte chauffeur : statuts + stats en haut (sans aller en sous-page),
 *  informations groupées en catégories, et bascule clair/sombre. */
import { IdvCalloutClient } from "@/components/idv/idv-callout-client";

export function DCompte({ gate }: { gate: ChauffeurGate }) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [, startLang] = useTransition();
  // Langue : bascule FR ⇄ AR et ENREGISTRE le choix (cookie NEXT_LOCALE, 1 an)
  // via l'action serveur, puis rafraîchit pour appliquer la nouvelle locale + RTL.
  const switchLang = () =>
    startLang(async () => {
      await setLocale(isAr ? "fr" : "ar");
      router.refresh();
    });
  const [fin, setFin] = useState<ChauffeurFinances | null>(null);
  const [homeAddr, setHomeAddr] = useState(gate.homeAddr);
  const [sosContacts, setSosContactsState] = useState<SosContact[]>([]);
  const [contactsOpen, setContactsOpen] = useState(false);

  // Modals « collecte d'info » — designés (plus de window.prompt/alert).
  // Domicile : sélection sur CARTE + recherche d'adresse (repère exact).
  const [homeOpen, setHomeOpen] = useState(false);
  const [homePos, setHomePos] = useState<LatLng | null>(null);
  const [homeErr, setHomeErr] = useState<string | null>(null);
  const [homeSaving, setHomeSaving] = useState(false);
  const [ccpOpen, setCcpOpen] = useState(false);
  const [ccpNum, setCcpNum] = useState("");
  const [ccpKey, setCcpKey] = useState("");
  const [ccpErr, setCcpErr] = useState<string | null>(null);
  const [ccpSaving, setCcpSaving] = useState(false);

  useEffect(() => {
    void getChauffeurFinances().then(setFin);
    void getChauffeurSosContacts().then(setSosContactsState);
  }, []);

  const since = new Date(gate.memberSince).getFullYear();
  const plan = fin?.plan ?? "free";
  const badge = getDriverBadge({
    ridesCount: gate.ridesCount,
    rating: gate.rating,
  });

  const openHome = () => {
    setHomePos(null);
    setHomeErr(null);
    setHomeOpen(true);
  };
  const saveHome = async () => {
    if (!homePos) {
      setHomeErr(
        tr("Placez le repère sur votre domicile.", "ضع العلامة على منزلك.")
      );
      return;
    }
    setHomeSaving(true);
    setHomeErr(null);
    // Adresse lisible du repère (échec silencieux → libellé générique).
    const text =
      (await reverseGeocode(homePos.lat, homePos.lng).catch(() => null)) ??
      tr("Domicile (repère carte)", "المنزل (علامة على الخريطة)");
    const res = await setChauffeurHome(text, homePos);
    setHomeSaving(false);
    if (res.ok) {
      setHomeAddr(text);
      setHomeOpen(false);
    } else {
      setHomeErr(res.error ?? tr("Enregistrement impossible.", "تعذّر الحفظ."));
    }
  };

  const openCcp = () => {
    setCcpNum("");
    setCcpKey("");
    setCcpErr(null);
    setCcpOpen(true);
  };
  const saveCcp = async () => {
    if (!ccpNum.trim()) {
      setCcpErr(
        tr("Saisissez votre numéro CCP.", "أدخل رقم حسابك البريدي CCP.")
      );
      return;
    }
    setCcpSaving(true);
    setCcpErr(null);
    const res = await setChauffeurCcp(ccpNum.trim(), ccpKey.trim());
    setCcpSaving(false);
    if (res?.ok === false) {
      setCcpErr(res.error ?? tr("Enregistrement impossible.", "تعذّر الحفظ."));
      return;
    }
    setCcpOpen(false);
  };

  // Statut du dossier de documents (remonté en haut).
  const docStatus = gate.rejectedReason
    ? { label: tr("Dossier refusé", "ملف مرفوض"), tone: "rejected" as const }
    : !gate.submitted
      ? {
          label: tr("À compléter", "بحاجة إلى استكمال"),
          tone: "pending" as const,
        }
      : gate.isVerified
        ? { label: tr("À jour", "محدَّث"), tone: "ok" as const }
        : {
            label: tr("En vérification", "قيد التحقّق"),
            tone: "pending" as const,
          };

  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <h1 className="drive-sora mb-3.5 text-[21px] font-extrabold tracking-[-0.5px]">
        {tr("Compte", "الحساب")}
      </h1>

      {/* Vérification d'identité (IDV) : s'efface si non publiée ou déjà faite. */}
      <IdvCalloutClient profile="chauffeur" />

      {/* Profil — l'avatar porte l'anneau de couleur du badge (toujours visible). */}
      <div className="mb-3 flex items-center gap-3">
        <span
          className="inline-block shrink-0 rounded-full p-[2.5px]"
          style={{ background: badge.gradient }}
        >
          <span className="block rounded-full border-2 border-[var(--d-surface)]">
            <ChAvatar
              name={gate.firstName}
              url={gate.avatarUrl}
              size={56}
              textClassName="text-[21px]"
            />
          </span>
        </span>
        <span className="min-w-0">
          <span className="drive-sora flex items-center gap-2 text-[17px] font-bold">
            {gate.firstName}{" "}
            {gate.fullName.split(" ").slice(1).join(" ")[0] ?? ""}.
            {plan === "premium" && (
              <span className="rounded-full bg-[#E8B53C] px-2.5 py-0.5 text-[10px] font-extrabold text-[#3a2c00]">
                👑 Premium
              </span>
            )}
          </span>
          <span className="mt-1 mb-1 block">
            <DriverBadgePill badge={badge} size="md" withTitle />
          </span>
          <span className="text-[13px] text-[var(--d-muted)]">
            {gate.rating != null && (
              <b className="text-[var(--d-ink)]">
                ★ {String(gate.rating).replace(".", ",")}
              </b>
            )}
            {gate.rating != null && " · "}
            {gate.ridesCount} {tr("courses", "مشوارًا")} · {tr("depuis", "منذ")}{" "}
            {since}
          </span>
        </span>
      </div>

      {/* Statuts (remontés en haut) : vérification + dossier */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {gate.isVerified ? (
          <PartnerStatusChip tone="ok" icon={<BadgeCheck className="size-3" />}>
            {tr("Compte vérifié", "حساب موثَّق")}
          </PartnerStatusChip>
        ) : (
          <PartnerStatusChip tone="pending" icon={<Clock className="size-3" />}>
            {tr("Compte en vérification", "حساب قيد التحقّق")}
          </PartnerStatusChip>
        )}
        <PartnerStatusChip
          tone={docStatus.tone}
          icon={<FileCheck className="size-3" />}
        >
          {tr("Documents", "الوثائق")} · {docStatus.label}
        </PartnerStatusChip>
      </div>

      {/* ── Catégorie : Véhicule & documents ── */}
      <PartnerMenuGroup title={tr("Véhicule & documents", "المركبة والوثائق")}>
        <PartnerMenuRow
          icon={<Car className="size-4" />}
          label={tr("Véhicule", "المركبة")}
          value={
            <>
              {gate.vehicle ?? tr("À compléter", "بحاجة إلى استكمال")} ·{" "}
              <b style={{ color: VIOLET }}>
                {gate.gamme === "classic"
                  ? "Classic"
                  : gate.gamme === "confort"
                    ? tr("Confort", "كونفور")
                    : tr("Moto", "دراجة نارية")}
              </b>
            </>
          }
        />
        <PartnerMenuRow
          icon={<FileCheck className="size-4" />}
          label={tr("Documents", "الوثائق")}
          value={
            <span
              style={{
                color: docStatus.tone === "rejected" ? "#E5484D" : GO,
              }}
            >
              {docStatus.label}
            </span>
          }
          onClick={() => router.push("/chauffeur/documents")}
        />
      </PartnerMenuGroup>

      {/* ── Catégorie : Finances ── */}
      <PartnerMenuGroup title={tr("Finances", "المالية")}>
        <PartnerMenuRow
          icon={<CreditCard className="size-4" />}
          label={tr("Abonnement", "الاشتراك")}
          value={`${(isAr ? PLAN_LABEL_AR : PLAN_LABEL)[plan]} · ${fin ? fmtPct(fin.planRate) : "…"}`}
          onClick={() => router.push("/chauffeur/abonnement")}
        />
        <PartnerMenuRow
          icon={<Wallet className="size-4" />}
          label={tr("Portefeuille & recharge", "المحفظة والتعبئة")}
          value={tr("Solde · recharger", "الرصيد · تعبئة")}
          onClick={() => router.push("/chauffeur/recharger")}
        />
        <PartnerMenuRow
          icon={<CreditCard className="size-4" />}
          label={tr("Mon CCP (versements)", "حسابي CCP (الدفعات)")}
          value={tr("Renseigner / modifier", "إدخال / تعديل")}
          onClick={openCcp}
        />
      </PartnerMenuGroup>

      {/* ── Catégorie : Préférences & sécurité ── */}
      <PartnerMenuGroup
        title={tr("Préférences & sécurité", "التفضيلات والأمان")}
      >
        <PartnerMenuRow
          icon={<Home className="size-4" />}
          label={tr("Domicile", "المنزل")}
          value={
            <span className="inline-flex items-center gap-1">
              {homeAddr ?? tr("À renseigner", "بحاجة إلى إدخال")}{" "}
              <Pencil className="size-3" />
            </span>
          }
          onClick={openHome}
        />
        <PartnerMenuRow
          icon={<ShieldAlert className="size-4" />}
          label={tr("Contacts d'urgence", "جهات اتصال الطوارئ")}
          value={
            sosContacts.length > 0
              ? sosContacts.map((x) => x.name).join(", ")
              : tr("À renseigner", "بحاجة إلى إدخال")
          }
          onClick={() => setContactsOpen(true)}
        />
        <PartnerMenuRow
          icon={<Globe className="size-4" />}
          label={tr("Langue", "اللغة")}
          value={
            <span className="inline-flex items-center gap-1.5">
              <LocaleFlag locale={isAr ? "ar" : "fr"} className="w-5" />
              {isAr ? "العربية" : "Français"}
            </span>
          }
          onClick={switchLang}
        />
        <DarkModeRow />
        <SoundRow />
      </PartnerMenuGroup>

      {/* Déconnexion — pending immédiat + erreur INLINE (composant partagé,
          même retour visuel que le compte client). */}
      <PartnerLogoutRow
        onLogout={async () => {
          // Course en cours → déconnexion bloquée par le serveur (terminer
          // d'abord). Sinon : hors ligne (intention locale ; le serveur met
          // déjà chauffeur_presence.is_online=false) → re-login hors ligne.
          const res = await chauffeurLogout();
          if (res?.error) return res.error;
          setChauffeurOnlineLocal(false);
          return null;
        }}
      />

      {/* Télécharger l'app Android « Coligo Drive » */}
      <Link
        href="/chauffeur/telecharger"
        className="mt-4 flex items-center gap-3 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] p-4 text-[var(--d-ink)] transition-colors hover:bg-[var(--d-surface)]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--d-surface)]">
          <Smartphone className="size-5" style={{ color: VIOLET }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {tr("Télécharger l’application Android", "تحميل تطبيق أندرويد")}
          </span>
          <span className="block text-xs opacity-70">
            {tr(
              "Notifications fiables et plein écran.",
              "إشعارات موثوقة وشاشة كاملة."
            )}
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 opacity-50 rtl:rotate-180" />
      </Link>

      <div className="mt-4">
        <InstallAppButton className="border-[var(--d-line)] bg-[var(--d-soft)] text-[var(--d-ink)] hover:bg-[var(--d-surface)]" />
      </div>

      <SosContactsSheet
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        contacts={sosContacts}
        onSave={async (next) => {
          const res = await setChauffeurSosContacts(next);
          if (res.ok) setSosContactsState(next);
          return res;
        }}
      />

      {/* Modal designé — Domicile (remplace window.prompt) */}
      <FormModal
        open={homeOpen}
        title={tr("Mon domicile", "منزلي")}
        onClose={() => setHomeOpen(false)}
        onSave={() => void saveHome()}
        saving={homeSaving}
        error={homeErr}
      >
        <p className="mb-2 text-[12px] text-[var(--d-muted)]">
          {tr(
            "Cherchez votre adresse ou déplacez la carte pour placer le repère exactement sur votre domicile. Modifiable 1×/semaine (anti-fraude).",
            "ابحث عن عنوانك أو حرّك الخريطة لوضع العلامة على منزلك بدقة. قابل للتعديل مرة واحدة في الأسبوع (مكافحة الاحتيال)."
          )}
        </p>
        <MapPositionPicker
          initial={null}
          autoLocate
          searchEnabled
          height={300}
          gpsLabel={tr("Ma position", "موقعي")}
          onChange={(p) => setHomePos(p)}
        />
      </FormModal>

      {/* Modal designé — CCP (remplace window.prompt) */}
      <FormModal
        open={ccpOpen}
        title={tr("Mon CCP (versements)", "حسابي CCP (الدفعات)")}
        onClose={() => setCcpOpen(false)}
        onSave={() => void saveCcp()}
        saving={ccpSaving}
        error={ccpErr}
      >
        <p className="mb-2 text-[12px] text-[var(--d-muted)]">
          {tr(
            "Vos versements seront virés sur ce compte CCP.",
            "ستُحوَّل دفعاتك إلى هذا الحساب البريدي CCP."
          )}
        </p>
        <input
          value={ccpNum}
          onChange={(e) => setCcpNum(e.target.value)}
          inputMode="numeric"
          placeholder={tr("Numéro CCP", "رقم CCP")}
          className="mb-2 w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-[14px] outline-none focus:border-[color:var(--d-muted)]"
        />
        <input
          value={ccpKey}
          onChange={(e) => setCcpKey(e.target.value)}
          inputMode="numeric"
          placeholder={tr("Clé CCP (2 chiffres)", "مفتاح CCP (رقمان)")}
          className="w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-[14px] outline-none focus:border-[color:var(--d-muted)]"
        />
      </FormModal>
    </div>
  );
}

/** Modal de saisie designé (bottom-sheet) — remplace window.prompt/alert. */
function FormModal({
  open,
  title,
  onClose,
  onSave,
  saving,
  error,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  const isAr = useLocale() === "ar";
  if (!open) return null;
  return (
    <Portal>
      <div
        className="fixed inset-0 z-[130] flex flex-col justify-end bg-black/45"
        onClick={onClose}
      >
        <div
          className="drive-jakarta rounded-t-[24px] bg-[var(--d-surface)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <b className="drive-sora text-[16px] font-extrabold">{title}</b>
            <button
              type="button"
              onClick={onClose}
              aria-label={isAr ? "إغلاق" : "Fermer"}
              className="grid size-9 place-items-center rounded-full bg-[var(--d-soft)]"
            >
              <X className="size-4" />
            </button>
          </div>
          {children}
          {error && (
            <p
              className="mt-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
              style={{ background: "rgba(229,72,77,.1)", color: "#E5484D" }}
            >
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="drive-sora mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-extrabold text-white disabled:opacity-60"
            style={{ background: VIOLET }}
          >
            {saving ? <Loader2 className="size-5 animate-spin" /> : null}
            {isAr ? "حفظ" : "Enregistrer"}
          </button>
        </div>
      </div>
    </Portal>
  );
}

/** Bascule clair / sombre (cookie coligo_theme + classe theme-dark) — l'espace
 *  chauffeur consomme `.theme-dark .drive-jakarta`, donc le sombre s'applique. */
function DarkModeRow() {
  const isAr = useLocale() === "ar";
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("theme-dark"));
  }, []);

  const toggle = () => {
    if (dark === null) return;
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("theme-dark", next);
    // Instantané : cookie persisté en arrière-plan, PAS de router.refresh().
    void setTheme(next ? "dark" : "light");
  };

  return (
    <PartnerMenuRow
      icon={
        dark ? (
          <Moon className="size-4" style={{ color: VIOLET }} />
        ) : (
          <Sun className="size-4" style={{ color: VIOLET }} />
        )
      }
      label={isAr ? "الوضع الداكن" : "Mode sombre"}
      onClick={toggle}
      trailing={
        <span
          role="switch"
          aria-checked={dark === true}
          className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
          style={{ background: dark ? VIOLET : "#D6D9E2" }}
        >
          <span
            className="absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all"
            style={{ insetInlineStart: dark ? 18 : 2 }}
          />
        </span>
      }
    />
  );
}

/** Interrupteur « Sons » (sonnerie de course entrante) — même patron que le
 *  mode sombre : préférence locale instantanée (sound-store chauffeur), la
 *  vibration reste active quoi qu'il arrive (canal séparé). */
function SoundRow() {
  const isAr = useLocale() === "ar";
  const on = useChauffeurSound();
  return (
    <PartnerMenuRow
      icon={
        on ? (
          <Volume2 className="size-4" style={{ color: VIOLET }} />
        ) : (
          <VolumeX className="size-4" style={{ color: VIOLET }} />
        )
      }
      label={isAr ? "أصوات الإشعارات" : "Sons de notification"}
      onClick={() => toggleChauffeurSound()}
      trailing={
        <span
          role="switch"
          aria-checked={on}
          className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
          style={{ background: on ? VIOLET : "#D6D9E2" }}
        >
          <span
            className="absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all"
            style={{ insetInlineStart: on ? 18 : 2 }}
          />
        </span>
      }
    />
  );
}
