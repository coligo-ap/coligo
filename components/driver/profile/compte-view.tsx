"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { driverLogout } from "@/app/(driver)/actions";
import { useDriverDark, toggleDriverDark } from "@/lib/driver/theme-store";
import { useDriverSound, toggleDriverSound } from "@/lib/driver/sound-store";
import { openSupportChat } from "@/components/support/tawk-chat";
import { toast } from "@/components/ui/toast";
import { setDriverOnline } from "@/lib/driver/online-store";
import { getActiveCourse } from "@/lib/driver/active-course-store";

/**
 * Écran COMPTE livreur — refonte « pro » : hero violet (avatar + nom + statut
 * de compte), 3 tuiles stats (note / courses / ancienneté), carte encours,
 * puis les sections « Mes informations » (children), les préférences et le
 * support. Reste scopé [data-space="driver"] (palette + Sora/Jakarta).
 */
export type CompteData = {
  initials: string;
  avatarUrl: string | null;
  fullName: string;
  ratingAvg: number;
  ratingCount: number;
  coursesCount: number;
  joinedYear: number | null;
  verified: boolean;
  frozen: boolean;
  vehicleLabel: string | null;
  vehiclePlate: string | null;
  payoutMethod: string | null;
  payoutDetails: string | null;
  outstandingDa: number;
  capDa: number;
};

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function CompteView({
  data,
  children,
}: {
  data: CompteData;
  children?: React.ReactNode;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const dark = useDriverDark();
  const soundOn = useDriverSound();
  const pct = Math.min(
    100,
    Math.round((data.outstandingDa / Math.max(1, data.capDa)) * 100)
  );
  const overCap = data.outstandingDa >= data.capDa;
  const status = data.frozen
    ? { cls: "red", label: tr("Compte gelé", "حساب مجمّد") }
    : data.verified
      ? { cls: "ok", label: tr("Vérifié ✓", "موثّق ✓") }
      : {
          cls: "warn",
          label: tr("En cours de vérification", "قيد التحقق"),
        };

  return (
    <>
      <div className="head">
        <h1>{tr("Mon compte", "حسابي")}</h1>
      </div>

      {/* Hero */}
      <div className="acc-hero">
        <div className="av">
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.avatarUrl}
              alt={tr("Photo de profil", "صورة الملف")}
            />
          ) : (
            data.initials
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="nm">{data.fullName}</div>
          <span className={"acc-chip " + status.cls}>{status.label}</span>
          {data.joinedYear && (
            <div className="sub">
              {isAr
                ? `سائق كوليغو منذ ${data.joinedYear}`
                : `Livreur Coligo depuis ${data.joinedYear}`}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="acc-stats">
        <div className="acc-stat">
          <div className="v">
            {data.ratingAvg ? data.ratingAvg.toFixed(1) : "—"}
            <small> ★</small>
          </div>
          <div className="l">{tr("Note", "التقييم")}</div>
        </div>
        <div className="acc-stat">
          <div className="v">{data.coursesCount}</div>
          <div className="l">{tr("Courses", "التوصيلات")}</div>
        </div>
        <div className="acc-stat">
          <div className="v">{data.joinedYear ?? "—"}</div>
          <div className="l">{tr("Membre depuis", "عضو منذ")}</div>
        </div>
      </div>

      {/* Encours */}
      <div className="acc-grp">
        {tr("Encours & versement", "المستحقّات والتسديد")}
      </div>
      <div className="floatc">
        <div className="top">
          <span>{tr("Encours à reverser", "مستحقّات للتسديد")}</span>
          <b style={overCap ? { color: "var(--red)" } : undefined}>
            {grp(data.outstandingDa)} / {grp(data.capDa)} DA
          </b>
        </div>
        <div className="bar">
          <i
            style={{
              width: `${Math.max(2, pct)}%`,
              background: overCap ? "var(--red)" : undefined,
            }}
          />
        </div>
        <div className="note">
          {overCap
            ? tr(
                "Plafond atteint : l'acceptation de nouvelles courses est suspendue jusqu'au versement.",
                "بلغت الحد الأقصى: يُعلَّق قبول توصيلات جديدة حتى التسديد."
              )
            : tr(
                "Au-delà du plafond, l'acceptation de nouvelles courses est suspendue jusqu'au versement.",
                "عند تجاوز الحد، يُعلَّق قبول توصيلات جديدة حتى التسديد."
              )}
        </div>
      </div>

      {/* Sections « Mes informations » (véhicule / pièces / versement) */}
      {children}

      {/* Tournées — rejoindre un commerçant + accès au démarrage. */}
      <div className="acc-grp">{tr("Tournées", "الجولات")}</div>
      <div className="menu">
        <Mrow
          label={tr("Mes tournées", "جولاتي")}
          chevron
          href="/driver/tournees"
          icon={
            <>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M3 10h18M8 2v4M16 2v4" />
            </>
          }
        />
        <Mrow
          label={tr("Rejoindre un commerçant", "الانضمام إلى تاجر")}
          chevron
          href="/driver/codes"
          icon={
            <>
              <circle cx="8" cy="15" r="4" />
              <path d="M10.85 12.15 19 4M18 5l2 2M15 8l2 2" />
            </>
          }
        />
      </div>

      {/* Préférences */}
      <div className="acc-grp">{tr("Préférences", "التفضيلات")}</div>
      <div className="menu">
        <Mrow
          label={tr("Apparence", "المظهر")}
          value={dark ? tr("Sombre", "داكن") : tr("Clair", "فاتح")}
          onClick={() => toggleDriverDark()}
          icon={
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
            </>
          }
        />
        <Mrow
          label={tr("Sons", "الأصوات")}
          value={soundOn ? tr("Activés", "مفعّلة") : tr("Coupés", "مكتومة")}
          onClick={() => toggleDriverSound()}
          icon={
            soundOn ? (
              <>
                <path d="M11 5 6 9H2v6h4l5 4z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
              </>
            ) : (
              <>
                <path d="M11 5 6 9H2v6h4l5 4z" />
                <path d="M22 9l-6 6M16 9l6 6" />
              </>
            )
          }
        />
        <Mrow
          label={tr("Langue", "اللغة")}
          value="Français · العربية"
          icon={
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
            </>
          }
        />
      </div>

      {/* Support & compte */}
      <div className="acc-grp">{tr("Support & compte", "الدعم والحساب")}</div>
      <div className="menu">
        <Mrow
          label={tr("Aide & support", "المساعدة والدعم")}
          chevron
          onClick={() => openSupportChat()}
          icon={
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 17v.01M12 13.5a2.5 2.5 0 1 0-2.5-3" />
            </>
          }
        />
        <button
          type="button"
          className="mrow danger"
          onClick={() => {
            // Course en cours → déconnexion bloquée (terminer d'abord). Le
            // serveur revérifie ; ici pré-contrôle client immédiat.
            if (getActiveCourse()) {
              toast.error(
                tr(
                  "Terminez votre course en cours avant de vous déconnecter.",
                  "أنهِ توصيلتك الجارية قبل تسجيل الخروج."
                )
              );
              return;
            }
            setDriverOnline(false);
            void driverLogout().then((res) => {
              if (res?.error) toast.error(res.error);
            });
          }}
        >
          <span className="ic">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </span>
          {tr("Se déconnecter", "تسجيل الخروج")}
        </button>
      </div>
    </>
  );
}

function Mrow({
  label,
  value,
  valueColor,
  chevron,
  onClick,
  href,
  icon,
}: {
  label: string;
  value?: string;
  valueColor?: string;
  chevron?: boolean;
  onClick?: () => void;
  href?: string;
  icon: React.ReactNode;
}) {
  const content = (
    <>
      <span className="ic">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </span>
      {label}
      <span
        className="va"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
        {chevron && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="mrow">
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="mrow" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="mrow">{content}</div>;
}
