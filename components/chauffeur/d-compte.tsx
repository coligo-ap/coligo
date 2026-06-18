"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  LogOut,
  Moon,
  Pencil,
  ShieldAlert,
  Smartphone,
  Sun,
  Wallet,
  X,
} from "lucide-react";
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
import { PLAN_LABEL, fmtPct } from "./d-ui";
import { InstallAppButton } from "@/components/pwa/install-app-button";
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

/** Compte chauffeur : statuts + stats en haut (sans aller en sous-page),
 *  informations groupées en catégories, et bascule clair/sombre. */
export function DCompte({ gate }: { gate: ChauffeurGate }) {
  const router = useRouter();
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

  const openHome = () => {
    setHomePos(null);
    setHomeErr(null);
    setHomeOpen(true);
  };
  const saveHome = async () => {
    if (!homePos) {
      setHomeErr("Placez le repère sur votre domicile.");
      return;
    }
    setHomeSaving(true);
    setHomeErr(null);
    // Adresse lisible du repère (échec silencieux → libellé générique).
    const text =
      (await reverseGeocode(homePos.lat, homePos.lng).catch(() => null)) ??
      "Domicile (repère carte)";
    const res = await setChauffeurHome(text, homePos);
    setHomeSaving(false);
    if (res.ok) {
      setHomeAddr(text);
      setHomeOpen(false);
    } else {
      setHomeErr(res.error ?? "Enregistrement impossible.");
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
      setCcpErr("Saisissez votre numéro CCP.");
      return;
    }
    setCcpSaving(true);
    setCcpErr(null);
    const res = await setChauffeurCcp(ccpNum.trim(), ccpKey.trim());
    setCcpSaving(false);
    if (res?.ok === false) {
      setCcpErr(res.error ?? "Enregistrement impossible.");
      return;
    }
    setCcpOpen(false);
  };

  // Statut du dossier de documents (remonté en haut).
  const docStatus = gate.rejectedReason
    ? { label: "Dossier refusé", tone: "rejected" as const }
    : !gate.submitted
      ? { label: "À compléter", tone: "pending" as const }
      : gate.isVerified
        ? { label: "À jour", tone: "ok" as const }
        : { label: "En vérification", tone: "pending" as const };

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      <h1 className="drive-sora mb-3.5 text-[21px] font-extrabold tracking-[-0.5px]">
        Compte
      </h1>

      {/* Profil */}
      <div className="mb-3 flex items-center gap-3">
        <ChAvatar
          name={gate.firstName}
          url={gate.avatarUrl}
          size={56}
          textClassName="text-[21px]"
        />
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
          <span className="text-[13px] text-[var(--d-muted)]">
            {gate.rating != null && (
              <b className="text-[var(--d-ink)]">
                ★ {String(gate.rating).replace(".", ",")}
              </b>
            )}
            {gate.rating != null && " · "}
            {gate.ridesCount} courses · depuis {since}
          </span>
        </span>
      </div>

      {/* Statuts (remontés en haut) : vérification + dossier */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {gate.isVerified ? (
          <StatusChip tone="ok" icon={<BadgeCheck className="size-3" />}>
            Compte vérifié
          </StatusChip>
        ) : (
          <StatusChip tone="pending" icon={<Clock className="size-3" />}>
            Compte en vérification
          </StatusChip>
        )}
        <StatusChip
          tone={docStatus.tone}
          icon={<FileCheck className="size-3" />}
        >
          Documents · {docStatus.label}
        </StatusChip>
      </div>

      {/* Stats en haut (déjà chargées → aucun coût serveur en plus). Tap = détail. */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatCard
          label="Aujourd'hui"
          value={fin ? formatDA(fin.todayNet) : "…"}
          sub={`${fin?.todayRides ?? 0} courses`}
          onClick={() => router.push("/chauffeur/gains")}
        />
        <StatCard
          label="Ce mois"
          value={fin ? formatDA(fin.monthNet) : "…"}
          sub={`${fin?.monthRides ?? 0} courses`}
          onClick={() => router.push("/chauffeur/gains")}
        />
      </div>

      {/* ── Catégorie : Véhicule & documents ── */}
      <Section title="Véhicule & documents">
        <Row
          icon={<Car className="size-4" />}
          label="Véhicule"
          value={
            <>
              {gate.vehicle ?? "À compléter"} ·{" "}
              <b style={{ color: VIOLET }}>
                {gate.gamme === "classic"
                  ? "Classic"
                  : gate.gamme === "confort"
                    ? "Confort"
                    : "Moto"}
              </b>
            </>
          }
        />
        <Row
          icon={<FileCheck className="size-4" />}
          label="Documents"
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
      </Section>

      {/* ── Catégorie : Finances ── */}
      <Section title="Finances">
        <Row
          icon={<CreditCard className="size-4" />}
          label="Abonnement"
          value={`${PLAN_LABEL[plan]} · ${fin ? fmtPct(fin.planRate) : "…"}`}
          onClick={() => router.push("/chauffeur/abonnement")}
        />
        <Row
          icon={<Wallet className="size-4" />}
          label="Portefeuille & recharge"
          value="Solde · recharger"
          onClick={() => router.push("/chauffeur/recharger")}
        />
        <Row
          icon={<CreditCard className="size-4" />}
          label="Mon CCP (versements)"
          value="Renseigner / modifier"
          onClick={openCcp}
        />
      </Section>

      {/* ── Catégorie : Préférences & sécurité ── */}
      <Section title="Préférences & sécurité">
        <Row
          icon={<Home className="size-4" />}
          label="Domicile"
          value={
            <span className="inline-flex items-center gap-1">
              {homeAddr ?? "À renseigner"} <Pencil className="size-3" />
            </span>
          }
          onClick={openHome}
        />
        <Row
          icon={<ShieldAlert className="size-4" />}
          label="Contacts d'urgence"
          value={
            sosContacts.length > 0
              ? sosContacts.map((x) => x.name).join(", ")
              : "À renseigner"
          }
          onClick={() => setContactsOpen(true)}
        />
        <Row
          icon={<Globe className="size-4" />}
          label="Langue"
          value="FR · العربية"
        />
        <DarkModeRow />
      </Section>

      {/* Déconnexion */}
      <button
        type="button"
        onClick={() => void chauffeurLogout()}
        className="mt-3 flex w-full items-center gap-3 rounded-[16px] border border-[var(--d-line)] px-3.5 py-3.5 text-left text-[13.5px] font-semibold"
        style={{ color: "#E5484D" }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
          <LogOut className="size-4" style={{ color: "#E5484D" }} />
        </span>
        Se déconnecter
      </button>

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
            Télécharger l’application Android
          </span>
          <span className="block text-xs opacity-70">
            Notifications fiables et plein écran.
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 opacity-50" />
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
        title="Mon domicile"
        onClose={() => setHomeOpen(false)}
        onSave={() => void saveHome()}
        saving={homeSaving}
        error={homeErr}
      >
        <p className="mb-2 text-[12px] text-[var(--d-muted)]">
          Cherchez votre adresse ou déplacez la carte pour placer le repère
          exactement sur votre domicile. Modifiable 1×/semaine (anti-fraude).
        </p>
        <MapPositionPicker
          initial={null}
          autoLocate
          searchEnabled
          height={300}
          gpsLabel="Ma position"
          onChange={(p) => setHomePos(p)}
        />
      </FormModal>

      {/* Modal designé — CCP (remplace window.prompt) */}
      <FormModal
        open={ccpOpen}
        title="Mon CCP (versements)"
        onClose={() => setCcpOpen(false)}
        onSave={() => void saveCcp()}
        saving={ccpSaving}
        error={ccpErr}
      >
        <p className="mb-2 text-[12px] text-[var(--d-muted)]">
          Vos versements seront virés sur ce compte CCP.
        </p>
        <input
          value={ccpNum}
          onChange={(e) => setCcpNum(e.target.value)}
          inputMode="numeric"
          placeholder="Numéro CCP"
          className="mb-2 w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-[14px] outline-none focus:border-[color:var(--d-muted)]"
        />
        <input
          value={ccpKey}
          onChange={(e) => setCcpKey(e.target.value)}
          inputMode="numeric"
          placeholder="Clé CCP (2 chiffres)"
          className="w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-[14px] outline-none focus:border-[color:var(--d-muted)]"
        />
      </FormModal>
    </div>
  );
}

/** En-tête de catégorie + conteneur de lignes (liste bordée). */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 px-1 text-[11px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
        {title}
      </p>
      <div className="overflow-hidden rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)]">
        {children}
      </div>
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
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[130] flex flex-col justify-end bg-black/45"
      onClick={onClose}
    >
      <div
        className="drive-jakarta rounded-t-[24px] bg-[var(--d-surface)] p-4 pb-[max(16px,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <b className="drive-sora text-[16px] font-extrabold">{title}</b>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
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
          Enregistrer
        </button>
      </div>
    </div>
  );
}

function StatusChip({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "pending" | "rejected";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const style =
    tone === "ok"
      ? { background: "rgba(22,179,100,.12)", color: GO }
      : tone === "rejected"
        ? { background: "rgba(229,72,77,.12)", color: "#E5484D" }
        : { background: "#EEEEFD", color: VIOLET };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold"
      style={style}
    >
      {icon}
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3 text-left"
    >
      <span className="flex items-center justify-between text-[11px] font-medium text-[var(--d-muted)]">
        {label}
        <ChevronRight className="size-3.5 opacity-60" />
      </span>
      <span className="drive-sora mt-0.5 text-[18px] leading-none font-extrabold tracking-[-0.5px]">
        {value}
      </span>
      <span className="mt-0.5 text-[10px] text-[var(--d-muted)]">{sub}</span>
    </button>
  );
}

/** Bascule clair / sombre (cookie coligo_theme + classe theme-dark) — l'espace
 *  chauffeur consomme `.theme-dark .drive-jakarta`, donc le sombre s'applique. */
function DarkModeRow() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("theme-dark"));
  }, []);

  const toggle = () => {
    if (pending || dark === null) return;
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("theme-dark", next);
    start(async () => {
      await setTheme(next ? "dark" : "light");
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark === true}
      onClick={toggle}
      className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-3.5 py-3.5 text-left text-[13.5px] font-semibold"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
        {dark ? (
          <Moon className="size-4" style={{ color: VIOLET }} />
        ) : (
          <Sun className="size-4" style={{ color: VIOLET }} />
        )}
      </span>
      <span className="flex-1">Mode sombre</span>
      <span
        className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
        style={{ background: dark ? VIOLET : "#D6D9E2" }}
      >
        <span
          className="absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all"
          style={{ insetInlineStart: dark ? 18 : 2 }}
        />
      </span>
    </button>
  );
}

function Row({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-3.5 py-3.5 text-left text-[13.5px] font-semibold last:border-b-0"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <span className="max-w-[50%] truncate text-right text-xs font-medium text-[var(--d-muted)]">
        {value}
      </span>
      {onClick && (
        <ChevronRight className="size-4 shrink-0 text-[var(--d-muted)] opacity-70" />
      )}
    </Tag>
  );
}
