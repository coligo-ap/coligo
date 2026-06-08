"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  HelpCircle,
  KeyRound,
  Loader2,
  LogOut,
  Settings,
} from "lucide-react";
import { useFormStatus } from "react-dom";
import { driverLogout } from "@/app/(driver)/actions";
import { DriverProfileForm } from "@/components/driver/profile-form";
import { DriverNotificationsPanel } from "@/components/driver/notifications/notifications-panel";

/**
 * Écran 6 — MON PROFIL (style Uber). Hero (avatar + nom + badges) + 3 stats +
 * liste menu. Les actions sont des liens vers les écrans existants ou des
 * panneaux dépliables (mes infos, notifications) ; la déconnexion réutilise
 * l'action serveur `driverLogout`. Aucune logique métier modifiée.
 */

type Stats = { courses: number; avgMin: number | null; merchants: number };

export function ProfileHub({
  fullName,
  phone,
  initials,
  isActive,
  ratingAvg,
  ratingCount,
  stats,
}: {
  fullName: string;
  phone: string;
  initials: string;
  isActive: boolean;
  ratingAvg: number;
  ratingCount: number;
  stats: Stats;
}) {
  const [open, setOpen] = useState<"infos" | "notif" | null>(null);
  const toggle = (k: "infos" | "notif") =>
    setOpen((cur) => (cur === k ? null : k));

  return (
    <div className="space-y-3 pb-4">
      <h1 className="px-1 text-[17px] font-bold text-[#0a0a0a]">Mon profil</h1>

      {/* Hero */}
      <div className="rounded-[16px] bg-white px-5 py-6 text-center shadow-[0_4px_16px_rgba(0,0,0,.06)]">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-black text-[22px] font-extrabold text-white">
          {initials}
        </div>
        <h2 className="mt-3 text-[17px] font-bold text-[#0a0a0a]">
          {fullName}
        </h2>
        <p className="mt-0.5 text-[13px] font-medium text-[#757575]">{phone}</p>

        {/* Note moyenne (réelle) — étoiles violettes. */}
        {ratingCount > 0 ? (
          <div className="mt-2.5 flex items-center justify-center gap-1.5">
            <span className="text-[14px] tracking-[1px] text-[#6c2bd9]">
              {"★".repeat(Math.round(ratingAvg))}
              <span className="text-[#d8d8e8]">
                {"★".repeat(5 - Math.round(ratingAvg))}
              </span>
            </span>
            <b className="text-[14px] font-extrabold text-[#0a0a0a]">
              {ratingAvg.toFixed(1).replace(".", ",")}
            </b>
            <span className="text-[12px] font-medium text-[#757575]">
              · {ratingCount} avis
            </span>
          </div>
        ) : (
          <p className="mt-2.5 text-[12px] font-medium text-[#9e9e9e]">
            Pas encore de note client
          </p>
        )}

        <div className="mt-3.5 flex flex-wrap justify-center gap-[7px]">
          {isActive && <Badge tone="success">✓ Validé</Badge>}
          <Badge>📦 {stats.courses} courses</Badge>
        </div>
      </div>

      {/* 3 stats */}
      <div className="grid grid-cols-3 gap-[9px]">
        <Stat value={String(stats.courses)} label="Courses" />
        <Stat
          value={stats.avgMin != null ? `${stats.avgMin} min` : "—"}
          label="Moy. livraison"
        />
        <Stat value={String(stats.merchants)} label="Commerces" />
      </div>

      {/* Menu */}
      <div className="overflow-hidden rounded-[14px] bg-white shadow-[0_4px_16px_rgba(0,0,0,.06)]">
        <MenuButton
          icon={<Settings className="size-[15px]" />}
          label="Mes informations"
          onClick={() => toggle("infos")}
        />
        {open === "infos" && (
          <div className="border-b border-[#eee] bg-[#fafafa] px-4 py-4">
            <DriverProfileForm
              initialFullName={fullName}
              initialPhone={phone}
            />
          </div>
        )}

        <MenuButton
          icon={<span className="text-[14px]">🔔</span>}
          label="Notifications"
          onClick={() => toggle("notif")}
        />
        {open === "notif" && (
          <div className="border-b border-[#eee] bg-[#fafafa] px-4 py-4">
            <DriverNotificationsPanel />
          </div>
        )}

        <MenuLink
          href="/driver/codes"
          icon={<KeyRound className="size-[15px]" />}
          label="Rejoindre un commerçant"
        />
        <MenuLink
          href="mailto:coligo.noreply@gmail.com?subject=Support%20livreur"
          icon={<HelpCircle className="size-[15px]" />}
          label="Aide & support"
        />

        <form action={driverLogout}>
          <LogoutItem />
        </form>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success";
}) {
  // « Validé » = concept de réussite → vert ; les autres badges restent neutres.
  const cls =
    tone === "success"
      ? "bg-[#e6f7ee] text-[#00854f]"
      : "bg-[#f2f2f2] text-[#0a0a0a]";
  return (
    <span
      className={
        "inline-flex items-center gap-[5px] rounded-full px-3 py-1.5 text-[11px] font-bold " +
        cls
      }
    >
      {children}
    </span>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[13px] bg-white p-[14px_10px] text-center shadow-[0_4px_12px_rgba(0,0,0,.04)]">
      <b className="block text-[18px] font-extrabold tracking-[-0.3px] text-[#0a0a0a]">
        {value}
      </b>
      <small className="mt-1 block text-[10px] font-semibold tracking-[0.3px] text-[#757575] uppercase">
        {label}
      </small>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  danger,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-[13px] px-4 py-[15px]">
      <span
        className={
          "grid size-8 shrink-0 place-items-center rounded-full " +
          (danger ? "bg-[#ffebeb] text-[#e53935]" : "bg-[#f5f5f5] text-black")
        }
      >
        {icon}
      </span>
      <span
        className={
          "flex-1 text-[14px] " +
          (danger ? "font-bold text-[#e53935]" : "font-semibold text-[#0a0a0a]")
        }
      >
        {label}
      </span>
      {trailing ?? <ChevronRight className="size-[18px] text-[#9e9e9e]" />}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border-b border-[#eee] text-left active:bg-[#fafafa]"
    >
      <MenuRow icon={icon} label={label} />
    </button>
  );
}

function MenuLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="block border-b border-[#eee] active:bg-[#fafafa]"
    >
      <MenuRow icon={icon} label={label} />
    </Link>
  );
}

function LogoutItem() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full text-left active:bg-[#fafafa] disabled:opacity-60"
    >
      <MenuRow
        icon={
          pending ? (
            <Loader2 className="size-[15px] animate-spin" />
          ) : (
            <LogOut className="size-[15px]" />
          )
        }
        label={pending ? "Déconnexion…" : "Déconnexion"}
        danger
        trailing={<span className="text-[18px] text-[#e53935]">›</span>}
      />
    </button>
  );
}
