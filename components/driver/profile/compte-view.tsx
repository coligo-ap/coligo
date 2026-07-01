"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
import {
  CalendarDays,
  Globe,
  KeyRound,
  LifeBuoy,
  LogOut,
  SunMoon,
  Volume2,
  VolumeX,
} from "lucide-react";
import { setLocale } from "@/i18n/actions";
import { driverLogout } from "@/app/(driver)/actions";
import { useDriverDark, toggleDriverDark } from "@/lib/driver/theme-store";
import { useDriverSound, toggleDriverSound } from "@/lib/driver/sound-store";
import { openSupportChat } from "@/components/support/tawk-chat";
import { setDriverOnline } from "@/lib/driver/online-store";
import { getActiveCourse } from "@/lib/driver/active-course-store";
import {
  PartnerInlineError,
  PartnerMenuGroup,
  PartnerMenuRow,
} from "@/components/shared/partner-ui";

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
  const [logoutErr, setLogoutErr] = useState<string | null>(null);
  const router = useRouter();
  const [, startLang] = useTransition();
  // Langue : bascule FR ⇄ AR et ENREGISTRE le choix (cookie NEXT_LOCALE, 1 an)
  // via l'action serveur, puis rafraîchit pour appliquer la nouvelle locale + RTL.
  const switchLang = () =>
    startLang(async () => {
      await setLocale(isAr ? "fr" : "ar");
      router.refresh();
    });
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

      {/* Tournées — rejoindre un commerçant + accès au démarrage.
          Menu = primitives PARTAGÉES (mêmes composants que l'espace chauffeur). */}
      <PartnerMenuGroup title={tr("Tournées", "الجولات")}>
        <PartnerMenuRow
          icon={<CalendarDays className="size-[18px]" />}
          label={tr("Mes tournées", "جولاتي")}
          chevron
          href="/driver/tournees"
        />
        <PartnerMenuRow
          icon={<KeyRound className="size-[18px]" />}
          label={tr("Rejoindre un commerçant", "الانضمام إلى تاجر")}
          chevron
          href="/driver/codes"
        />
      </PartnerMenuGroup>

      {/* Préférences */}
      <PartnerMenuGroup title={tr("Préférences", "التفضيلات")}>
        <PartnerMenuRow
          icon={<SunMoon className="size-[18px]" />}
          label={tr("Apparence", "المظهر")}
          value={dark ? tr("Sombre", "داكن") : tr("Clair", "فاتح")}
          onClick={() => toggleDriverDark()}
        />
        <PartnerMenuRow
          icon={
            soundOn ? (
              <Volume2 className="size-[18px]" />
            ) : (
              <VolumeX className="size-[18px]" />
            )
          }
          label={tr("Sons", "الأصوات")}
          value={soundOn ? tr("Activés", "مفعّلة") : tr("Coupés", "مكتومة")}
          onClick={() => toggleDriverSound()}
        />
        <PartnerMenuRow
          icon={<Globe className="size-[18px]" />}
          label={tr("Langue", "اللغة")}
          value={isAr ? "العربية" : "Français"}
          onClick={switchLang}
        />
      </PartnerMenuGroup>

      {/* Support & compte */}
      <PartnerMenuGroup title={tr("Support & compte", "الدعم والحساب")}>
        <PartnerMenuRow
          icon={<LifeBuoy className="size-[18px]" />}
          label={tr("Aide & support", "المساعدة والدعم")}
          chevron
          onClick={() => openSupportChat()}
        />
        <PartnerMenuRow
          icon={<LogOut className="size-[18px]" />}
          label={tr("Se déconnecter", "تسجيل الخروج")}
          danger
          onClick={() => {
            // Course en cours → déconnexion bloquée (terminer d'abord). Le
            // serveur revérifie ; ici pré-contrôle client immédiat. Message
            // INLINE sous le menu (règle produit, pas de toast).
            if (getActiveCourse()) {
              setLogoutErr(
                tr(
                  "Terminez votre course en cours avant de vous déconnecter.",
                  "أنهِ توصيلتك الجارية قبل تسجيل الخروج."
                )
              );
              return;
            }
            setLogoutErr(null);
            setDriverOnline(false);
            void driverLogout().then((res) => {
              if (res?.error) setLogoutErr(res.error);
            });
          }}
        />
      </PartnerMenuGroup>
      {logoutErr ? (
        <div className="mt-2">
          <PartnerInlineError>{logoutErr}</PartnerInlineError>
        </div>
      ) : null}
    </>
  );
}
