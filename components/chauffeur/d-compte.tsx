"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Car,
  CreditCard,
  FileCheck,
  Globe,
  Home,
  LogOut,
  Pencil,
} from "lucide-react";
import { VIOLET } from "@/components/customer/drive/drive-modals";
import { DNav, PLAN_LABEL, fmtPct } from "./d-ui";
import {
  chauffeurLogout,
  getChauffeurFinances,
  setChauffeurHome,
  type ChauffeurFinances,
  type ChauffeurGate,
} from "@/app/(chauffeur)/actions";

/** Compte chauffeur (maquette s-dcompte). */
export function DCompte({ gate }: { gate: ChauffeurGate }) {
  const router = useRouter();
  const [fin, setFin] = useState<ChauffeurFinances | null>(null);
  const [homeAddr, setHomeAddr] = useState(gate.homeAddr);

  useEffect(() => {
    void getChauffeurFinances().then(setFin);
  }, []);

  const since = new Date(gate.memberSince).getFullYear();
  const plan = fin?.plan ?? "free";

  const editHome = async () => {
    const v = window.prompt("Adresse de votre domicile :", homeAddr ?? "");
    if (v == null || !v.trim()) return;
    setHomeAddr(v.trim());
    await setChauffeurHome(v.trim());
  };

  return (
    <div className="drive-jakarta min-h-screen bg-white px-5 pt-4 pb-24">
      <h1 className="drive-sora mb-3.5 text-[21px] font-extrabold tracking-[-0.5px]">
        Compte
      </h1>

      <div className="mb-4 flex items-center gap-3">
        <span
          className="drive-sora grid size-14 shrink-0 place-items-center rounded-full text-[21px] font-extrabold text-white"
          style={{ background: `linear-gradient(135deg,#7B7BF0,${VIOLET})` }}
        >
          {gate.firstName[0]?.toUpperCase()}
        </span>
        <span>
          <span className="drive-sora flex items-center gap-2 text-[17px] font-bold">
            {gate.firstName}{" "}
            {gate.fullName.split(" ").slice(1).join(" ")[0] ?? ""}.
            {plan === "premium" && (
              <span className="rounded-full bg-[#E8B53C] px-2.5 py-0.5 text-[10px] font-extrabold text-[#3a2c00]">
                👑 Premium
              </span>
            )}
          </span>
          <span className="text-[13px] text-[#6B7280]">
            {gate.rating != null && (
              <b className="text-[#0B0C12]">
                ★ {String(gate.rating).replace(".", ",")}
              </b>
            )}
            {gate.rating != null && " · "}
            {gate.ridesCount} courses · depuis {since}
          </span>
        </span>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[#EEF0F4] bg-white">
        <Row
          icon={<Car className="size-4" />}
          label="Véhicule"
          value={
            <>
              {gate.vehicle ?? "À compléter"} ·{" "}
              <b style={{ color: VIOLET }}>
                Gamme{" "}
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
          icon={<CreditCard className="size-4" />}
          label="Abonnement"
          value={`${PLAN_LABEL[plan]} · ${fin ? fmtPct(fin.planRate) : "…"}`}
          onClick={() => router.push("/chauffeur/abonnement")}
        />
        <Row
          icon={<Home className="size-4" />}
          label="Domicile (je rentre chez moi)"
          value={
            <span className="inline-flex items-center gap-1">
              {homeAddr ?? "À renseigner"} <Pencil className="size-3" />
            </span>
          }
          onClick={editHome}
        />
        <Row
          icon={<FileCheck className="size-4" />}
          label="Documents"
          value={<span style={{ color: "#16B364" }}>À jour ✓</span>}
          onClick={() => router.push("/chauffeur/documents")}
        />
        <Row
          icon={<Globe className="size-4" />}
          label="Langue"
          value="FR · العربية"
        />
        <button
          type="button"
          onClick={() => void chauffeurLogout()}
          className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left text-[13.5px] font-semibold"
          style={{ color: "#E5484D" }}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[#F4F5F9]">
            <LogOut className="size-4" style={{ color: "#E5484D" }} />
          </span>
          Se déconnecter
        </button>
      </div>

      <DNav />
    </div>
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
      className="flex w-full items-center gap-3 border-b border-[#EEF0F4] px-3.5 py-3.5 text-left text-[13.5px] font-semibold"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[#F4F5F9]">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <span className="max-w-[55%] text-right text-xs font-medium text-[#6B7280]">
        {value}
      </span>
    </Tag>
  );
}
