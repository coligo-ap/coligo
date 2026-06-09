"use client";

import { driverLogout } from "@/app/(driver)/actions";
import { useDriverDark, toggleDriverDark } from "@/lib/driver/theme-store";
import { openSupportChat } from "@/components/support/tawk-chat";

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
  const dark = useDriverDark();
  const pct = Math.min(
    100,
    Math.round((data.outstandingDa / Math.max(1, data.capDa)) * 100)
  );
  const overCap = data.outstandingDa >= data.capDa;
  const status = data.frozen
    ? { cls: "red", label: "Compte gelé" }
    : data.verified
      ? { cls: "ok", label: "Vérifié ✓" }
      : { cls: "warn", label: "En cours de vérification" };

  return (
    <>
      <div className="head">
        <h1>Mon compte</h1>
      </div>

      {/* Hero */}
      <div className="acc-hero">
        <div className="av">
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatarUrl} alt="Photo de profil" />
          ) : (
            data.initials
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="nm">{data.fullName}</div>
          <span className={"acc-chip " + status.cls}>{status.label}</span>
          {data.joinedYear && (
            <div className="sub">Livreur Coligo depuis {data.joinedYear}</div>
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
          <div className="l">Note</div>
        </div>
        <div className="acc-stat">
          <div className="v">{data.coursesCount}</div>
          <div className="l">Courses</div>
        </div>
        <div className="acc-stat">
          <div className="v">{data.joinedYear ?? "—"}</div>
          <div className="l">Membre depuis</div>
        </div>
      </div>

      {/* Encours */}
      <div className="acc-grp">Encours & versement</div>
      <div className="floatc">
        <div className="top">
          <span>Encours à reverser</span>
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
            ? "Plafond atteint : l'acceptation de nouvelles courses est suspendue jusqu'au versement."
            : "Au-delà du plafond, l'acceptation de nouvelles courses est suspendue jusqu'au versement."}
        </div>
      </div>

      {/* Sections « Mes informations » (véhicule / pièces / versement) */}
      {children}

      {/* Préférences */}
      <div className="acc-grp">Préférences</div>
      <div className="menu">
        <Mrow
          label="Apparence"
          value={dark ? "Sombre" : "Clair"}
          onClick={() => toggleDriverDark()}
          icon={
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
            </>
          }
        />
        <Mrow
          label="Langue"
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
      <div className="acc-grp">Support & compte</div>
      <div className="menu">
        <Mrow
          label="Aide & support"
          chevron
          onClick={() => openSupportChat()}
          icon={
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 17v.01M12 13.5a2.5 2.5 0 1 0-2.5-3" />
            </>
          }
        />
        <form action={driverLogout}>
          <button type="submit" className="mrow danger">
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
            Se déconnecter
          </button>
        </form>
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
  icon,
}: {
  label: string;
  value?: string;
  valueColor?: string;
  chevron?: boolean;
  onClick?: () => void;
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
  if (onClick) {
    return (
      <button type="button" className="mrow" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="mrow">{content}</div>;
}
