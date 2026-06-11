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
  ShieldAlert,
} from "lucide-react";
import {
  SosContactsSheet,
  VIOLET,
  type SosContact,
} from "@/components/customer/drive/drive-modals";
import { DNav, PLAN_LABEL, fmtPct } from "./d-ui";
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

/** Compte chauffeur (maquette s-dcompte). */
export function DCompte({ gate }: { gate: ChauffeurGate }) {
  const router = useRouter();
  const [fin, setFin] = useState<ChauffeurFinances | null>(null);
  const [homeAddr, setHomeAddr] = useState(gate.homeAddr);
  const [sosContacts, setSosContactsState] = useState<SosContact[]>([]);
  const [contactsOpen, setContactsOpen] = useState(false);

  useEffect(() => {
    void getChauffeurFinances().then(setFin);
    void getChauffeurSosContacts().then(setSosContactsState);
  }, []);

  const since = new Date(gate.memberSince).getFullYear();
  const plan = fin?.plan ?? "free";

  const editHome = async () => {
    const v = window.prompt(
      "Adresse de votre domicile (modifiable 1 fois par semaine) :",
      homeAddr ?? ""
    );
    if (v == null || !v.trim()) return;
    // Le serveur applique la limite anti-fraude : on n'affiche la nouvelle
    // adresse QUE si le changement est accepté.
    const res = await setChauffeurHome(v.trim());
    if (res.ok) setHomeAddr(v.trim());
    else if (res.error) window.alert(res.error);
  };

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
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

      <div className="overflow-hidden rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)]">
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
          icon={<CreditCard className="size-4" />}
          label="Mon CCP (versements)"
          value="Renseigner / modifier"
          onClick={async () => {
            const num = window.prompt("Numéro CCP (pour vos versements) :", "");
            if (num == null) return;
            const key = window.prompt("Clé CCP :", "") ?? "";
            await setChauffeurCcp(num, key);
          }}
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
        <button
          type="button"
          onClick={() => void chauffeurLogout()}
          className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left text-[13.5px] font-semibold"
          style={{ color: "#E5484D" }}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
            <LogOut className="size-4" style={{ color: "#E5484D" }} />
          </span>
          Se déconnecter
        </button>
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
      className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-3.5 py-3.5 text-left text-[13.5px] font-semibold"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <span className="max-w-[55%] text-right text-xs font-medium text-[var(--d-muted)]">
        {value}
      </span>
    </Tag>
  );
}
