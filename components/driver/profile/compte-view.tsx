"use client";

import { driverLogout } from "@/app/(driver)/actions";
import { useDriverDark, toggleDriverDark } from "@/lib/driver/theme-store";

/**
 * Écran COMPTE reproduit À L'IDENTIQUE de MAQUETTE-livreur-pages : .prof
 * (avatar + note + ancienneté) + .floatc (encours/plafond) + .menu (.mrow :
 * Véhicule, Documents, Versement, Apparence clair/sombre, Langue, Aide,
 * Déconnexion). Données réelles.
 */
export type CompteData = {
  initials: string;
  avatarUrl: string | null;
  fullName: string;
  ratingAvg: number;
  ratingCount: number;
  coursesCount: number;
  joinedYear: number | null;
  vehicleLabel: string | null;
  vehiclePlate: string | null;
  payoutMethod: string | null;
  payoutDetails: string | null;
  outstandingDa: number;
  capDa: number;
};

const METHOD_LABEL: Record<string, string> = {
  ccp: "CCP",
  baridimob: "BaridiMob",
  bank: "Virement",
};

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function CompteView({ data }: { data: CompteData }) {
  const dark = useDriverDark();
  const pct = Math.min(
    100,
    Math.round((data.outstandingDa / Math.max(1, data.capDa)) * 100)
  );
  const vehicle =
    data.vehicleLabel || data.vehiclePlate
      ? [data.vehicleLabel, data.vehiclePlate].filter(Boolean).join(" · ")
      : "Non renseigné";
  const payout =
    data.payoutMethod && METHOD_LABEL[data.payoutMethod]
      ? `${METHOD_LABEL[data.payoutMethod]}${data.payoutDetails ? ` ••• ${data.payoutDetails.slice(-4)}` : ""}`
      : "À configurer";

  return (
    <>
      <div className="head">
        <h1>Compte</h1>
      </div>

      <div className="prof">
        <div className="av" style={{ overflow: "hidden" }}>
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.avatarUrl}
              alt="Photo de profil"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            data.initials
          )}
        </div>
        <div>
          <div className="nm">{data.fullName}</div>
          <div className="sub">
            <b>★ {data.ratingAvg ? data.ratingAvg.toFixed(1) : "—"}</b> ·{" "}
            {data.coursesCount} course{data.coursesCount > 1 ? "s" : ""}
            {data.joinedYear ? ` · Livreur depuis ${data.joinedYear}` : ""}
          </div>
        </div>
      </div>

      <div className="floatc">
        <div className="top">
          <span>Encours à reverser</span>
          <b>
            {grp(data.outstandingDa)} / {grp(data.capDa)} DA
          </b>
        </div>
        <div className="bar">
          <i style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <div className="note">
          Au-delà du plafond, l&apos;acceptation de nouvelles courses est
          suspendue jusqu&apos;au versement.
        </div>
      </div>

      <div className="menu">
        <Mrow
          label="Véhicule"
          value={vehicle}
          icon={
            <>
              <circle cx="5.5" cy="16.5" r="3" />
              <circle cx="18.5" cy="16.5" r="3" />
              <path d="M5.5 16.5 9 10h5l2 3.5" />
            </>
          }
        />
        <Mrow
          label="Documents"
          value="À jour ✓"
          valueColor="var(--go)"
          icon={
            <>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </>
          }
        />
        <Mrow
          label="Versement"
          value={payout}
          icon={
            <>
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
            </>
          }
        />
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
        <Mrow
          label="Aide & support"
          chevron
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
