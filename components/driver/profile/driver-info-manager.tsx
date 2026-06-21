"use client";

import {
  useActionState,
  useEffect,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { toast } from "@/components/ui/toast";
import {
  saveDriverVehicleSelf,
  submitDriverDocument,
  addDriverPayoutSelf,
  deleteDriverPayoutSelf,
  proposeVehicleChange,
  proposePayoutChange,
} from "@/app/(driver)/actions";

type ActionState = { ok?: boolean; error?: string };

export type SelfVehicle = {
  vehicle_type: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_year: number | null;
  vehicle_plate: string | null;
  national_id_number: string | null;
  id_card_number: string | null;
  wilaya: string | null;
  address: string | null;
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
const DOC_TYPES = [
  ["cni", "Carte d'identité", "بطاقة التعريف"],
  ["permis", "Permis de conduire", "رخصة السياقة"],
  ["carte_grise", "Carte grise", "البطاقة الرمادية"],
  ["passeport", "Passeport", "جواز السفر"],
  ["autre", "Autre", "أخرى"],
] as const;
const VEHICLE_TYPES = [
  ["moto", "Moto", "دراجة نارية"],
  ["scooter", "Scooter", "سكوتر"],
  ["velo", "Vélo", "دراجة"],
  ["voiture", "Voiture", "سيارة"],
  ["camionnette", "Camionnette", "شاحنة صغيرة"],
] as const;
const METHODS = [
  ["especes", "Espèces", "نقداً"],
  ["ccp", "CCP", "CCP"],
  ["baridimob", "BaridiMob", "BaridiMob"],
  ["virement", "Virement", "تحويل"],
] as const;
const lbl = (
  arr: ReadonlyArray<readonly [string, string, string]>,
  v: string | null,
  isAr = false
) => arr.find(([k]) => k === v)?.[isAr ? 2 : 1] ?? v ?? "—";

const inp: CSSProperties = {
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
const lab: CSSProperties = {
  fontSize: 11.5,
  color: "var(--muted)",
  fontWeight: 600,
  display: "block",
  marginBottom: 4,
};

function Spinner() {
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

function SubmitBtn({
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
function StatusPill({
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
function pillStyle(color: string, bg: string): CSSProperties {
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

function Section({
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
      style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}
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
          padding: "15px 16px",
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
      {open && <div style={{ padding: "0 16px 16px" }}>{children}</div>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | null }) {
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

function PendingBanner() {
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

export function DriverInfoManager({
  verified,
  vehicle,
  documents,
  payouts,
  requests,
}: {
  verified: boolean;
  vehicle: SelfVehicle;
  documents: SelfDoc[];
  payouts: SelfPayout[];
  requests: SelfRequest[];
}) {
  const isAr = useLocale() === "ar";
  const pendingKinds = new Set(
    requests.filter((r) => r.status === "pending").map((r) => r.kind)
  );
  return (
    <>
      <div className="acc-grp">{isAr ? "معلوماتي" : "Mes informations"}</div>

      {!verified && (
        <div
          className="card"
          style={{ borderColor: "var(--violet)", marginBottom: 14 }}
        >
          <b style={{ color: "var(--violet)" }}>
            {isAr ? "أكمل ملفك الشخصي" : "Complétez votre profil"}
          </b>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            {isAr
              ? "أدخل بيانات مركبتك ووثائقك وطريقة التسديد. كل شيء يبقى «قيد التحقق» حتى موافقة كوليغو. بعد التوثيق، كل تعديل جديد يمرّ عبر طلب."
              : "Renseignez votre véhicule, vos pièces et votre versement. Tout est « en cours de vérification » jusqu'à validation par Coligo. Une fois vérifié, chaque nouvelle modification repassera par une demande."}
          </p>
        </div>
      )}

      <VehicleSection
        vehicle={vehicle}
        verified={verified}
        pending={pendingKinds.has("vehicle")}
      />
      <DocsSection documents={documents} />
      <PayoutsSection
        payouts={payouts}
        verified={verified}
        pending={pendingKinds.has("payout")}
      />

      {requests.length > 0 && <RequestHistory requests={requests} />}
    </>
  );
}

// ---------------- Véhicule ----------------
function VehicleSection({
  vehicle,
  verified,
  pending,
}: {
  vehicle: SelfVehicle;
  verified: boolean;
  pending: boolean;
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [v, setV] = useState(vehicle);
  const set =
    (k: keyof SelfVehicle) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setV((s) => ({ ...s, [k]: e.target.value }));
  const [ok, setOk] = useState(false);
  // Vérifié → on PROPOSE (demande) ; sinon édition directe.
  const [state, action] = useActionState<ActionState, FormData>(
    verified ? proposeVehicleChange : saveDriverVehicleSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      setOk(true);
      toast.success(
        verified
          ? tr(
              "Demande envoyée — en cours de vérification",
              "تم إرسال الطلب — قيد التحقق"
            )
          : tr("Enregistré", "تم الحفظ")
      );
      router.refresh();
      const t = setTimeout(() => setOk(false), 2500);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
  }, [state, router, verified]);

  const badge = <StatusPill verified={verified} pending={pending} />;

  // Vérifié + une demande déjà en attente → lecture seule + bandeau.
  const sectionTitle = tr("Véhicule & identité", "المركبة والهوية");
  if (verified && pending) {
    return (
      <Section title={sectionTitle} badge={badge}>
        <PendingBanner />
        <VehicleReadonly v={v} />
      </Section>
    );
  }

  return (
    <Section title={sectionTitle} badge={badge} defaultOpen={!verified}>
      {verified && (
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {tr(
            "Modifiez puis envoyez : la demande sera appliquée après validation.",
            "عدّل ثم أرسل: يُطبَّق الطلب بعد الموافقة."
          )}
        </p>
      )}
      <form action={action} style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={lab}>{tr("Type de véhicule", "نوع المركبة")}</label>
          <select
            name="vehicle_type"
            value={v.vehicle_type ?? ""}
            onChange={set("vehicle_type")}
            style={inp}
          >
            <option value="">—</option>
            {VEHICLE_TYPES.map(([val, l, lar]) => (
              <option key={val} value={val}>
                {isAr ? lar : l}
              </option>
            ))}
          </select>
        </div>
        <Row>
          <CField
            name="vehicle_brand"
            label={tr("Marque", "العلامة")}
            value={v.vehicle_brand}
            onChange={set("vehicle_brand")}
          />
          <CField
            name="vehicle_model"
            label={tr("Modèle", "الطراز")}
            value={v.vehicle_model}
            onChange={set("vehicle_model")}
          />
        </Row>
        <Row>
          <CField
            name="vehicle_plate"
            label={tr("Immatriculation", "رقم التسجيل")}
            value={v.vehicle_plate}
            onChange={set("vehicle_plate")}
          />
          <CField
            name="vehicle_color"
            label={tr("Couleur", "اللون")}
            value={v.vehicle_color}
            onChange={set("vehicle_color")}
          />
        </Row>
        <Row>
          <CField
            name="vehicle_year"
            label={tr("Année", "السنة")}
            type="number"
            value={v.vehicle_year ? String(v.vehicle_year) : ""}
            onChange={set("vehicle_year")}
          />
          <CField
            name="wilaya"
            label={tr("Wilaya", "الولاية")}
            value={v.wilaya}
            onChange={set("wilaya")}
          />
        </Row>
        <Row>
          <CField
            name="id_card_number"
            label={tr("N° carte d'identité", "رقم بطاقة التعريف")}
            value={v.id_card_number}
            onChange={set("id_card_number")}
          />
          <CField
            name="national_id_number"
            label={tr("N° national", "الرقم الوطني")}
            value={v.national_id_number}
            onChange={set("national_id_number")}
          />
        </Row>
        <CField
          name="address"
          label={tr("Adresse", "العنوان")}
          value={v.address}
          onChange={set("address")}
        />
        <SubmitBtn
          idle={
            verified
              ? tr("Envoyer la demande", "إرسال الطلب")
              : tr("Enregistrer", "حفظ")
          }
          success={ok}
          successLabel={
            verified ? tr("Envoyée", "أُرسلت") : tr("Enregistré", "تم الحفظ")
          }
        />
      </form>
    </Section>
  );
}
function VehicleReadonly({ v }: { v: SelfVehicle }) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <>
      <KV
        k={tr("Type", "النوع")}
        v={lbl(VEHICLE_TYPES, v.vehicle_type, isAr)}
      />
      <KV
        k={tr("Véhicule", "المركبة")}
        v={[v.vehicle_brand, v.vehicle_model].filter(Boolean).join(" ") || null}
      />
      <KV k={tr("Immatriculation", "رقم التسجيل")} v={v.vehicle_plate} />
      <KV k={tr("Couleur", "اللون")} v={v.vehicle_color} />
      <KV
        k={tr("Année", "السنة")}
        v={v.vehicle_year ? String(v.vehicle_year) : null}
      />
      <KV
        k={tr("N° carte d'identité", "رقم بطاقة التعريف")}
        v={v.id_card_number}
      />
      <KV k={tr("N° national", "الرقم الوطني")} v={v.national_id_number} />
      <KV k={tr("Wilaya", "الولاية")} v={v.wilaya} />
      <KV k={tr("Adresse", "العنوان")} v={v.address} />
    </>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {children}
    </div>
  );
}
function CField({
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
function Field({
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
function docBadge(s: string, isAr: boolean) {
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

function DocsSection({ documents }: { documents: SelfDoc[] }) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [adding, setAdding] = useState(false);
  const [ok, setOk] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(
    submitDriverDocument,
    {}
  );
  // Aperçu AVANT envoi (rien n'est écrit tant que non envoyé).
  const [preview, setPreview] = useState<{
    name: string;
    url: string | null;
    isImage: boolean;
  } | null>(null);

  const clearPreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (preview?.url) URL.revokeObjectURL(preview.url);
    if (!f) {
      setPreview(null);
      return;
    }
    const isImage = f.type.startsWith("image/");
    setPreview({
      name: f.name,
      url: isImage ? URL.createObjectURL(f) : null,
      isImage,
    });
  };

  useEffect(() => {
    if (state.ok) {
      setOk(true);
      clearPreview();
      toast.success(
        tr(
          "Pièce envoyée — en cours de vérification",
          "تم إرسال الوثيقة — قيد التحقق"
        )
      );
      router.refresh();
      const t = setTimeout(() => {
        setOk(false);
        setAdding(false);
      }, 1300);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

  const hasPending = documents.some((d) => d.status === "pending");
  const allApproved =
    documents.length > 0 && documents.every((d) => d.status === "approved");
  const headBadge = hasPending ? (
    <span style={pillStyle("var(--amber)", "rgba(245,158,11,.14)")}>
      {tr("⏳ En vérification…", "⏳ قيد التحقق…")}
    </span>
  ) : allApproved ? (
    <span style={pillStyle("var(--go)", "var(--go-soft)")}>
      {tr("✓ Vérifiées", "✓ موثّقة")}
    </span>
  ) : undefined;

  return (
    <Section
      title={
        isAr
          ? `وثائق الهوية (${documents.length})`
          : `Pièces d'identité (${documents.length})`
      }
      badge={headBadge}
    >
      {documents.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
          {tr("Aucune pièce envoyée.", "لم تُرسل أي وثيقة.")}
        </p>
      )}
      {documents.map((d) => {
        const b = docBadge(d.status, isAr);
        return (
          <div
            key={d.id}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid var(--line)",
              fontSize: 13.5,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <b>{lbl(DOC_TYPES, d.doc_type, isAr)}</b>
              <span
                style={{
                  color: b.c,
                  background: b.bg,
                  fontWeight: 700,
                  fontSize: 11,
                  borderRadius: 20,
                  padding: "2px 9px",
                  whiteSpace: "nowrap",
                }}
              >
                {b.t}
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              {d.number ?? tr("N° —", "الرقم —")}
              {d.expires_at ? ` · ${tr("exp.", "تنتهي")} ${d.expires_at}` : ""}
            </div>
            {d.status === "rejected" && d.review_note && (
              <div style={{ color: "var(--red)", fontSize: 12, marginTop: 2 }}>
                {tr("Motif :", "السبب:")} {d.review_note}
              </div>
            )}
            {d.scanUrl && (
              <a
                href={d.scanUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--violet)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {tr("Revoir le document", "إعادة عرض الوثيقة")}
              </a>
            )}
          </div>
        );
      })}

      {adding ? (
        <form
          action={action}
          style={{ display: "grid", gap: 10, marginTop: 12 }}
        >
          <div>
            <label style={lab}>{tr("Type *", "النوع *")}</label>
            <select name="doc_type" required style={inp} defaultValue="cni">
              {DOC_TYPES.map(([val, l, lar]) => (
                <option key={val} value={val}>
                  {isAr ? lar : l}
                </option>
              ))}
            </select>
          </div>
          <Field name="number" label={tr("Numéro", "الرقم")} />
          <Row>
            <Field
              name="issued_at"
              label={tr("Émission", "تاريخ الإصدار")}
              type="date"
            />
            <Field
              name="expires_at"
              label={tr("Expiration", "تاريخ الانتهاء")}
              type="date"
            />
          </Row>

          {/* Sélection + APERÇU avant envoi */}
          <div>
            <label style={lab}>
              {tr(
                "Scan / photo * (JPG, PNG, WEBP ou PDF)",
                "مسح / صورة * (JPG, PNG, WEBP أو PDF)"
              )}
            </label>
            <input
              id="doc-file"
              name="file"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={onPick}
              style={{
                display: preview ? "none" : "block",
                ...inp,
                height: "auto",
                padding: 8,
              }}
            />
            {preview && (
              <div
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  padding: 10,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                {preview.isImage && preview.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview.url}
                    alt={tr("Aperçu", "معاينة")}
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "cover",
                      borderRadius: 8,
                      flex: "none",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 8,
                      background: "var(--soft)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--muted)",
                      flex: "none",
                    }}
                  >
                    PDF
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {preview.name}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                    <label
                      htmlFor="doc-file"
                      style={{
                        color: "var(--violet)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {tr("Remplacer", "استبدال")}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById(
                          "doc-file"
                        ) as HTMLInputElement | null;
                        if (el) el.value = "";
                        clearPreview();
                      }}
                      style={{
                        color: "var(--red)",
                        fontSize: 12,
                        fontWeight: 700,
                        background: "none",
                        border: 0,
                      }}
                    >
                      {tr("Retirer", "إزالة")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <p style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {tr(
              "Une fois envoyée, la pièce passe « en vérification » et ne peut plus être modifiée ni supprimée.",
              "بمجرد الإرسال، تصبح الوثيقة «قيد التحقق» ولا يمكن تعديلها أو حذفها."
            )}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <SubmitBtn
              idle={tr("Envoyer", "إرسال")}
              success={ok}
              successLabel={tr("Envoyée", "أُرسلت")}
            />
            <button
              type="button"
              className="btnlink"
              onClick={() => {
                clearPreview();
                setAdding(false);
              }}
            >
              {tr("Annuler", "إلغاء")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btnlink"
          style={{ textAlign: "left", marginTop: 10 }}
          onClick={() => setAdding(true)}
        >
          {tr("+ Envoyer une pièce", "+ إرسال وثيقة")}
        </button>
      )}
    </Section>
  );
}

// ---------------- Versement ----------------
function PayoutsSection({
  payouts,
  verified,
  pending,
}: {
  payouts: SelfPayout[];
  verified: boolean;
  pending: boolean;
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [adding, setAdding] = useState(false);
  const [del, startDel] = useTransition();
  const [ok, setOk] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(
    verified ? proposePayoutChange : addDriverPayoutSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      setOk(true);
      toast.success(
        verified
          ? tr(
              "Demande envoyée — en cours de vérification",
              "تم إرسال الطلب — قيد التحقق"
            )
          : tr("Moyen ajouté", "تمت إضافة الطريقة")
      );
      router.refresh();
      const t = setTimeout(() => {
        setOk(false);
        setAdding(false);
      }, 1300);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
  }, [state, router, verified]);

  return (
    <Section
      title={
        isAr ? `التسديد (${payouts.length})` : `Versement (${payouts.length})`
      }
      badge={<StatusPill verified={verified} pending={pending} />}
    >
      {verified && pending && <PendingBanner />}
      {payouts.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
          {tr("Aucun moyen de versement.", "لا توجد طريقة تسديد.")}
        </p>
      )}
      {payouts.map((p) => (
        <div
          key={p.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 0",
            borderBottom: "1px solid var(--line)",
            fontSize: 13.5,
          }}
        >
          <div>
            <b>
              {lbl(METHODS, p.method, isAr)}
              {p.is_default ? tr(" · défaut", " · افتراضي") : ""}
            </b>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {p.account_number ?? "—"}
              {p.account_name ? ` · ${p.account_name}` : ""}
            </div>
          </div>
          {!verified && (
            <button
              type="button"
              onClick={() => {
                if (!confirm(tr("Supprimer ce moyen ?", "حذف هذه الطريقة؟")))
                  return;
                startDel(async () => {
                  const r = await deleteDriverPayoutSelf(p.id);
                  if (r.error) toast.error(r.error);
                  else {
                    toast.success(tr("Supprimé", "تم الحذف"));
                    router.refresh();
                  }
                });
              }}
              disabled={del}
              style={{
                background: "none",
                border: 0,
                color: "var(--red)",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              {tr("Supprimer", "حذف")}
            </button>
          )}
        </div>
      ))}

      {verified && pending ? null : adding ? (
        <form
          action={action}
          style={{ display: "grid", gap: 10, marginTop: 12 }}
        >
          <div>
            <label style={lab}>{tr("Moyen *", "الطريقة *")}</label>
            <select name="method" required style={inp} defaultValue="ccp">
              {METHODS.map(([val, l, lar]) => (
                <option key={val} value={val}>
                  {isAr ? lar : l}
                </option>
              ))}
            </select>
          </div>
          <Field name="label" label={tr("Libellé", "التسمية")} />
          <Field
            name="account_number"
            label={tr("N° de compte / CCP / RIP", "رقم الحساب / CCP / RIP")}
          />
          <Field name="account_name" label={tr("Titulaire", "صاحب الحساب")} />
          <label
            style={{
              display: "flex",
              gap: 8,
              fontSize: 13,
              alignItems: "center",
            }}
          >
            <input type="checkbox" name="is_default" />{" "}
            {tr("Par défaut", "افتراضي")}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <SubmitBtn
              idle={
                verified
                  ? tr("Envoyer la demande", "إرسال الطلب")
                  : tr("Ajouter", "إضافة")
              }
              success={ok}
              successLabel={
                verified ? tr("Envoyée", "أُرسلت") : tr("Ajouté", "أُضيف")
              }
            />
            <button
              type="button"
              className="btnlink"
              onClick={() => setAdding(false)}
            >
              {tr("Annuler", "إلغاء")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btnlink"
          style={{ textAlign: "left", marginTop: 10 }}
          onClick={() => setAdding(true)}
        >
          {verified
            ? tr("+ Proposer un moyen", "+ اقتراح طريقة")
            : tr("+ Ajouter un moyen", "+ إضافة طريقة")}
        </button>
      )}
    </Section>
  );
}

// ---------------- Historique des demandes ----------------
function RequestHistory({ requests }: { requests: SelfRequest[] }) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const badge = (s: string) =>
    s === "approved"
      ? {
          t: tr("Approuvée ✓", "مقبولة ✓"),
          c: "var(--go)",
          bg: "var(--go-soft)",
        }
      : s === "rejected"
        ? { t: tr("Refusée", "مرفوضة"), c: "var(--red)", bg: "var(--red-soft)" }
        : {
            t: tr("En cours de vérification…", "قيد التحقق…"),
            c: "var(--amber)",
            bg: "rgba(245,158,11,.14)",
          };
  return (
    <Section title={tr("Mes demandes", "طلباتي")} defaultOpen={false}>
      {requests.map((r) => {
        const b = badge(r.status);
        return (
          <div
            key={r.id}
            style={{
              padding: "8px 0",
              borderBottom: "1px solid var(--line)",
              fontSize: 13,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <b style={{ textTransform: "capitalize" }}>{r.kind}</b>
              <span
                style={{
                  color: b.c,
                  background: b.bg,
                  fontWeight: 700,
                  fontSize: 11,
                  borderRadius: 20,
                  padding: "2px 9px",
                  whiteSpace: "nowrap",
                }}
              >
                {b.t}
              </span>
            </div>
            <div style={{ color: "var(--muted)" }}>{r.note}</div>
            {r.review_note && (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {tr("Réponse :", "الرد:")} {r.review_note}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}
