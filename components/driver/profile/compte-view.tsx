"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
import {
  BadgeCheck,
  CalendarDays,
  Clock,
  FileCheck,
  Globe,
  LifeBuoy,
  LogOut,
  Moon,
  ReceiptText,
  Smartphone,
  Snowflake,
  Sun,
  Volume2,
  VolumeX,
  Wallet,
  Zap,
} from "lucide-react";
import { setLocale } from "@/i18n/actions";
import { driverLogout } from "@/app/(driver)/actions";
import { useDriverDark, toggleDriverDark } from "@/lib/driver/theme-store";
import { useDriverSound, toggleDriverSound } from "@/lib/driver/sound-store";
import { openSupportChat } from "@/components/support/tawk-chat";
import { setDriverOnline } from "@/lib/driver/online-store";
import { getActiveCourse } from "@/lib/driver/active-course-store";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import {
  BRAND_GO,
  BRAND_RED,
  BRAND_VIOLET,
  PartnerInlineError,
  PartnerMenuGroup,
  PartnerMenuRow,
  PartnerProgress,
  PartnerStatusChip,
  SORA,
} from "@/components/shared/partner-ui";

/**
 * Écran COMPTE livreur — MÊME maquette que le Compte chauffeur (d-compte) :
 * profil en tête (avatar + note + ancienneté), chips de statut, catégories en
 * listes bordées (primitives partagées PartnerMenuGroup/Row), déconnexion en
 * ligne bordée + erreur inline, carte « Télécharger l'app ». Seule la LOGIQUE
 * MÉTIER diffère (encours/plafond COD, tournées, sons, thème livreur).
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
  const overCap = data.outstandingDa >= data.capDa;

  return (
    <>
      <h1
        className="mb-3.5 text-[21px] font-extrabold tracking-[-0.5px] text-[var(--d-ink)]"
        style={{ fontFamily: SORA }}
      >
        {tr("Compte", "الحساب")}
      </h1>

      {/* Profil (parité d-compte : avatar + nom + note · courses · depuis) */}
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full text-[21px] font-extrabold text-white"
          style={{
            fontFamily: SORA,
            background: `linear-gradient(135deg, #8a4dff, ${BRAND_VIOLET})`,
          }}
        >
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.avatarUrl}
              alt={tr("Photo de profil", "صورة الملف")}
              className="h-full w-full object-cover"
            />
          ) : (
            data.initials
          )}
        </span>
        <span className="min-w-0">
          <span
            className="block truncate text-[17px] font-bold text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {data.fullName}
          </span>
          <span className="text-[13px] text-[var(--d-muted)]">
            {data.ratingAvg > 0 && (
              <b className="text-[var(--d-ink)]">
                ★ {data.ratingAvg.toFixed(1).replace(".", ",")}
              </b>
            )}
            {data.ratingAvg > 0 && " · "}
            {data.coursesCount} {isAr ? "توصيلة" : "courses"}
            {data.joinedYear
              ? ` · ${tr("depuis", "منذ")} ${data.joinedYear}`
              : ""}
          </span>
        </span>
      </div>

      {/* Chips de statut */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {data.verified ? (
          <PartnerStatusChip tone="ok" icon={<BadgeCheck className="size-3" />}>
            {tr("Compte vérifié", "حساب موثّق")}
          </PartnerStatusChip>
        ) : (
          <PartnerStatusChip tone="pending" icon={<Clock className="size-3" />}>
            {tr("Compte en vérification", "حساب قيد التحقق")}
          </PartnerStatusChip>
        )}
        {data.frozen && (
          <PartnerStatusChip
            tone="rejected"
            icon={<Snowflake className="size-3" />}
          >
            {tr("Compte gelé", "حساب مجمّد")}
          </PartnerStatusChip>
        )}
      </div>

      {/* ── Mon dossier : UNE ligne — le détail (véhicule, pièces, CCP) vit
          dans la sous-page /driver/documents, pas de doublon ici. ── */}
      <PartnerMenuGroup title={tr("Mon dossier", "ملفي")}>
        <PartnerMenuRow
          icon={<FileCheck className="size-4" />}
          label={tr("Documents & véhicule", "الوثائق والمركبة")}
          value={
            <span style={{ color: data.verified ? BRAND_GO : "#c2790a" }}>
              {data.verified
                ? tr("À jour", "محدّثة")
                : tr("En vérification", "قيد التحقق")}
            </span>
          }
          href="/driver/documents"
        />
      </PartnerMenuGroup>

      {/* ── Finances : encours compact + accès (le détail vit en sous-pages) ── */}
      <PartnerMenuGroup title={tr("Finances", "المالية")}>
        <div className="border-b border-[var(--d-line)] px-3.5 py-3">
          <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
            <span className="font-semibold text-[var(--d-ink)]">
              {tr("Encours à reverser", "مستحقّات للتسديد")}
            </span>
            <b
              className="tabular-nums"
              style={{
                fontFamily: SORA,
                color: overCap ? BRAND_RED : "var(--d-ink)",
              }}
            >
              {grp(data.outstandingDa)} / {grp(data.capDa)} DA
            </b>
          </div>
          <PartnerProgress
            value={data.outstandingDa}
            max={data.capDa}
            tone={overCap ? BRAND_RED : BRAND_VIOLET}
          />
          {overCap && (
            <p
              className="mt-1.5 text-[11px] font-bold"
              style={{ color: BRAND_RED }}
            >
              {tr(
                "Plafond atteint : nouvelles courses suspendues jusqu'au versement.",
                "بلغت الحد الأقصى: تُعلَّق التوصيلات الجديدة حتى التسديد."
              )}
            </p>
          )}
        </div>
        <PartnerMenuRow
          icon={<Wallet className="size-4" />}
          label={tr("Portefeuille & recharge", "المحفظة والشحن")}
          href="/driver/recharger"
        />
        <PartnerMenuRow
          icon={<ReceiptText className="size-4" />}
          label={tr("Relevé & versement", "كشف الحساب والتسديد")}
          href="/driver/releve"
        />
        <PartnerMenuRow
          icon={<Zap className="size-4" />}
          label={tr("Abonnement & Pass Prioritaire", "الاشتراك والممر الأولوي")}
          href="/driver/abonnement"
        />
      </PartnerMenuGroup>

      {/* Cartes complémentaires éventuelles de la page. */}
      {children}

      {/* ── Tournées : une ligne (rejoindre un commerçant vit dans le hub). ── */}
      <PartnerMenuGroup title={tr("Tournées", "الجولات")}>
        <PartnerMenuRow
          icon={<CalendarDays className="size-4" />}
          label={tr("Mes tournées", "جولاتي")}
          href="/driver/tournees"
        />
      </PartnerMenuGroup>

      {/* ── Catégorie : Préférences ── */}
      <PartnerMenuGroup title={tr("Préférences", "التفضيلات")}>
        <PartnerMenuRow
          icon={
            dark ? (
              <Moon className="size-4" style={{ color: BRAND_VIOLET }} />
            ) : (
              <Sun className="size-4" style={{ color: BRAND_VIOLET }} />
            )
          }
          label={tr("Mode sombre", "الوضع الداكن")}
          onClick={() => toggleDriverDark()}
          trailing={
            <span
              role="switch"
              aria-checked={dark}
              className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
              style={{ background: dark ? BRAND_VIOLET : "#D6D9E2" }}
            >
              <span
                className="absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all"
                style={{ insetInlineStart: dark ? 18 : 2 }}
              />
            </span>
          }
        />
        <PartnerMenuRow
          icon={
            soundOn ? (
              <Volume2 className="size-4" />
            ) : (
              <VolumeX className="size-4" />
            )
          }
          label={tr("Sons", "الأصوات")}
          onClick={() => toggleDriverSound()}
          trailing={
            <span
              role="switch"
              aria-checked={soundOn}
              className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
              style={{ background: soundOn ? BRAND_VIOLET : "#D6D9E2" }}
            >
              <span
                className="absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all"
                style={{ insetInlineStart: soundOn ? 18 : 2 }}
              />
            </span>
          }
        />
        <PartnerMenuRow
          icon={<Globe className="size-4" />}
          label={tr("Langue", "اللغة")}
          value={isAr ? "العربية" : "Français"}
          onClick={switchLang}
        />
        <PartnerMenuRow
          icon={<LifeBuoy className="size-4" />}
          label={tr("Aide & support", "المساعدة والدعم")}
          onClick={() => openSupportChat()}
        />
      </PartnerMenuGroup>

      {/* Déconnexion — ligne bordée + erreur INLINE (parité d-compte). */}
      <button
        type="button"
        onClick={() => {
          // Course en cours → déconnexion bloquée (terminer d'abord). Le
          // serveur revérifie ; ici pré-contrôle client immédiat.
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
        className="mt-3 flex w-full items-center gap-3 rounded-[16px] border border-[var(--d-line)] px-3.5 py-3.5 text-left text-[13.5px] font-semibold"
        style={{ color: BRAND_RED }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
          <LogOut className="size-4" style={{ color: BRAND_RED }} />
        </span>
        {tr("Se déconnecter", "تسجيل الخروج")}
      </button>
      {logoutErr ? (
        <div className="mt-2">
          <PartnerInlineError>{logoutErr}</PartnerInlineError>
        </div>
      ) : null}

      {/* Application : une ligne discrète (le détail vit sur /driver/telecharger). */}
      <div className="mt-3">
        <PartnerMenuGroup>
          <PartnerMenuRow
            icon={<Smartphone className="size-4" />}
            label={tr("Application Android", "تطبيق أندرويد")}
            value={tr("Notifications fiables", "إشعارات موثوقة")}
            href="/driver/telecharger"
          />
        </PartnerMenuGroup>
      </div>
      <div className="mt-3">
        <InstallAppButton className="border-[var(--d-line)] bg-[var(--d-soft)] text-[var(--d-ink)] hover:bg-[var(--d-surface)]" />
      </div>
    </>
  );
}
