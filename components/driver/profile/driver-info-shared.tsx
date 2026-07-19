"use client";

import { useState, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import { useLocale } from "next-intl";

export type ActionState = { ok?: boolean; error?: string };

/**
 * Ce que le livreur voit et modifie de son véhicule. `vehicle_year`,
 * `national_id_number`, `id_card_number` et `address` n'en font plus partie :
 * ils restent en base, consultables par le super-admin.
 */
export type SelfVehicle = {
  vehicle_type: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_plate: string | null;
  wilaya: string | null;
};
export type SelfDoc = {
  id: string;
  doc_type: string;
  number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  hasScan: boolean;
  scanUrl: string | null;
  status: string;
  review_note: string | null;
};
export type SelfPayout = {
  id: string;
  method: string;
  label: string | null;
  account_number: string | null;
  account_name: string | null;
  is_default: boolean;
};
export type SelfRequest = {
  id: string;
  kind: string;
  note: string;
  status: string;
  review_note: string | null;
  created_at: string;
};

// [clé (valeur serveur), libellé FR, libellé AR]
export const DOC_TYPES = [
  ["cni", "Carte d'identité", "بطاقة التعريف"],
  ["permis", "Permis de conduire", "رخصة السياقة"],
  ["carte_grise", "Carte grise", "البطاقة الرمادية"],
  ["passeport", "Passeport", "جواز السفر"],
  ["autre", "Autre", "أخرى"],
] as const;
export const VEHICLE_TYPES = [
  ["moto", "Moto", "دراجة نارية"],
  ["scooter", "Scooter", "سكوتر"],
  ["velo", "Vélo", "دراجة"],
  ["voiture", "Voiture", "سيارة"],
  ["camionnette", "Camionnette", "شاحنة صغيرة"],
] as const;
export const METHODS = [
  ["especes", "Espèces", "نقداً"],
  ["ccp", "CCP", "CCP"],
  ["baridimob", "BaridiMob", "BaridiMob"],
  ["virement", "Virement", "تحويل"],
] as const;
export const lbl = (
  arr: ReadonlyArray<readonly [string, string, string]>,
  v: string | null,
  isAr = false
) => arr.find(([k]) => k === v)?.[isAr ? 2 : 1] ?? v ?? "—";

export const inp: CSSProperties = {
  width: "100%",
  height: 42,
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  padding: "0 12px",
  fontSize: 14,
  fontFamily: "inherit",
};
export const lab: CSSProperties = {
  fontSize: 11.5,
  color: "var(--muted)",
  fontWeight: 600,
  display: "block",
  marginBottom: 4,
};

export function Spinner() {
  return (
    <span
      style={{
        width: 14,
        height: 14,
        border: "2px solid rgba(255,255,255,.45)",
        borderTopColor: "#fff",
        borderRadius: "50%",
        display: "inline-block",
        animation: "mq-spin .7s linear infinite",
        marginRight: 7,
        verticalAlign: "-2px",
      }}
    />
  );
}

export function SubmitBtn({
  idle,
  success,
  successLabel = "Enregistré",
}: {
  idle: string;
  success: boolean;
  successLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="mq-btn"
      type="submit"
      disabled={pending}
      style={
        success
          ? {
              background: "var(--go)",
              boxShadow: "0 14px 28px -12px var(--go)",
            }
          : undefined
      }
    >
      {pending ? (
        <>
          <Spinner />
          Envoi…
        </>
      ) : success ? (
        `✓ ${successLabel}`
      ) : (
        idle
      )}
    </button>
  );
}

/** Pastille d'état d'une section : orange « en cours de vérification » / vert. */
export function StatusPill({
  verified,
  pending,
}: {
  verified: boolean;
  pending: boolean;
}) {
  const isAr = useLocale() === "ar";
  const checking = isAr ? "⏳ قيد التحقق…" : "⏳ En cours de vérification…";
  if (pending) {
    return (
      <span style={pillStyle("var(--amber)", "rgba(245,158,11,.14)")}>
        {checking}
      </span>
    );
  }
  if (verified) {
    return (
      <span style={pillStyle("var(--go)", "var(--go-soft)")}>
        {isAr ? "✓ موثّق" : "✓ Vérifié"}
      </span>
    );
  }
  return (
    <span style={pillStyle("var(--amber)", "rgba(245,158,11,.14)")}>
      {checking}
    </span>
  );
}
export function pillStyle(color: string, bg: string): CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 800,
    color,
    background: bg,
    borderRadius: 20,
    padding: "3px 8px",
    whiteSpace: "nowrap",
  };
}

export function Section({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="card"
      style={{ marginBottom: 10, padding: 0, overflow: "hidden" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: 0,
          padding: "13px 14px",
          cursor: "pointer",
          color: "var(--ink)",
        }}
      >
        <span
          className="mq-sora"
          style={{ fontSize: 15, fontWeight: 800, flex: 1, textAlign: "left" }}
        >
          {title}
        </span>
        {badge}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            width: 18,
            height: 18,
            stroke: "var(--muted)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .2s",
            flex: "none",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
        borderBottom: "1px solid var(--line)",
        fontSize: 13.5,
      }}
    >
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{v || "—"}</span>
    </div>
  );
}

export function PendingBanner() {
  const isAr = useLocale() === "ar";
  return (
    <div
      style={{
        background: "rgba(245,158,11,.12)",
        color: "var(--amber)",
        borderRadius: 10,
        padding: "9px 12px",
        fontSize: 12.5,
        fontWeight: 600,
        marginBottom: 10,
      }}
    >
      {isAr
        ? "⏳ التعديل قيد التحقق — سيُؤخذ بعين الاعتبار بعد موافقة كوليغو."
        : "⏳ Modification en cours de vérification — elle sera prise en compte après validation par Coligo."}
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {children}
    </div>
  );
}
export function CField({
  name,
  label,
  value,
  onChange,
  type = "text",
}: {
  name: string;
  label: string;
  value: string | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
}) {
  return (
    <div>
      <label style={lab}>{label}</label>
      <input
        name={name}
        type={type}
        value={value ?? ""}
        onChange={onChange}
        style={inp}
      />
    </div>
  );
}
export function Field({
  name,
  label,
  type = "text",
}: {
  name: string;
  label: string;
  type?: string;
}) {
  return (
    <div>
      <label style={lab}>{label}</label>
      <input name={name} type={type} style={inp} />
    </div>
  );
}

// ---------------- Documents ----------------
export function docBadge(s: string, isAr: boolean) {
  if (s === "approved")
    return {
      t: isAr ? "✓ موثّقة" : "✓ Vérifiée",
      c: "var(--go)",
      bg: "var(--go-soft)",
    };
  if (s === "rejected")
    return {
      t: isAr ? "مرفوضة" : "Refusée",
      c: "var(--red)",
      bg: "var(--red-soft)",
    };
  return {
    t: isAr ? "⏳ قيد التحقق" : "⏳ En vérification",
    c: "var(--amber)",
    bg: "rgba(245,158,11,.14)",
  };
}
