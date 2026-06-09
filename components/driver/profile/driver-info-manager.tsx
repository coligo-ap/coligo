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
import { toast } from "@/components/ui/toast";
import {
  saveDriverVehicleSelf,
  addDriverDocumentSelf,
  deleteDriverDocumentSelf,
  addDriverPayoutSelf,
  deleteDriverPayoutSelf,
  proposeVehicleChange,
  proposePayoutChange,
  proposeDocumentChange,
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

const DOC_TYPES = [
  ["cni", "Carte d'identité"],
  ["permis", "Permis de conduire"],
  ["carte_grise", "Carte grise"],
  ["passeport", "Passeport"],
  ["autre", "Autre"],
] as const;
const VEHICLE_TYPES = [
  ["moto", "Moto"],
  ["scooter", "Scooter"],
  ["velo", "Vélo"],
  ["voiture", "Voiture"],
  ["camionnette", "Camionnette"],
] as const;
const METHODS = [
  ["especes", "Espèces"],
  ["ccp", "CCP"],
  ["baridimob", "BaridiMob"],
  ["virement", "Virement"],
] as const;
const lbl = (arr: ReadonlyArray<readonly [string, string]>, v: string | null) =>
  arr.find(([k]) => k === v)?.[1] ?? v ?? "—";

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
  if (pending) {
    return (
      <span style={pillStyle("var(--amber)", "rgba(245,158,11,.14)")}>
        ⏳ En cours de vérification…
      </span>
    );
  }
  if (verified) {
    return (
      <span style={pillStyle("var(--go)", "var(--go-soft)")}>✓ Vérifié</span>
    );
  }
  return (
    <span style={pillStyle("var(--amber)", "rgba(245,158,11,.14)")}>
      ⏳ En cours de vérification…
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
      ⏳ Modification en cours de vérification — elle sera prise en compte après
      validation par Coligo.
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
  const pendingKinds = new Set(
    requests.filter((r) => r.status === "pending").map((r) => r.kind)
  );
  return (
    <>
      <div className="head">
        <h1>Mes informations</h1>
      </div>

      {!verified && (
        <div
          className="card"
          style={{ borderColor: "var(--violet)", marginBottom: 14 }}
        >
          <b style={{ color: "var(--violet)" }}>Complétez votre profil</b>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Renseignez votre véhicule, vos pièces et votre versement. Tout est «
            en cours de vérification » jusqu&apos;à validation par Coligo. Une
            fois vérifié, chaque nouvelle modification repassera par une
            demande.
          </p>
        </div>
      )}

      <VehicleSection
        vehicle={vehicle}
        verified={verified}
        pending={pendingKinds.has("vehicle")}
      />
      <DocsSection
        documents={documents}
        verified={verified}
        pending={pendingKinds.has("document")}
      />
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
        verified ? "Demande envoyée — en cours de vérification" : "Enregistré"
      );
      router.refresh();
      const t = setTimeout(() => setOk(false), 2500);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
  }, [state, router, verified]);

  const badge = <StatusPill verified={verified} pending={pending} />;

  // Vérifié + une demande déjà en attente → lecture seule + bandeau.
  if (verified && pending) {
    return (
      <Section title="Véhicule & identité" badge={badge}>
        <PendingBanner />
        <VehicleReadonly v={v} />
      </Section>
    );
  }

  return (
    <Section title="Véhicule & identité" badge={badge} defaultOpen={!verified}>
      {verified && (
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          Modifiez puis envoyez : la demande sera appliquée après validation.
        </p>
      )}
      <form action={action} style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={lab}>Type de véhicule</label>
          <select
            name="vehicle_type"
            value={v.vehicle_type ?? ""}
            onChange={set("vehicle_type")}
            style={inp}
          >
            <option value="">—</option>
            {VEHICLE_TYPES.map(([val, l]) => (
              <option key={val} value={val}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <Row>
          <CField
            name="vehicle_brand"
            label="Marque"
            value={v.vehicle_brand}
            onChange={set("vehicle_brand")}
          />
          <CField
            name="vehicle_model"
            label="Modèle"
            value={v.vehicle_model}
            onChange={set("vehicle_model")}
          />
        </Row>
        <Row>
          <CField
            name="vehicle_plate"
            label="Immatriculation"
            value={v.vehicle_plate}
            onChange={set("vehicle_plate")}
          />
          <CField
            name="vehicle_color"
            label="Couleur"
            value={v.vehicle_color}
            onChange={set("vehicle_color")}
          />
        </Row>
        <Row>
          <CField
            name="vehicle_year"
            label="Année"
            type="number"
            value={v.vehicle_year ? String(v.vehicle_year) : ""}
            onChange={set("vehicle_year")}
          />
          <CField
            name="wilaya"
            label="Wilaya"
            value={v.wilaya}
            onChange={set("wilaya")}
          />
        </Row>
        <Row>
          <CField
            name="id_card_number"
            label="N° carte d'identité"
            value={v.id_card_number}
            onChange={set("id_card_number")}
          />
          <CField
            name="national_id_number"
            label="N° national"
            value={v.national_id_number}
            onChange={set("national_id_number")}
          />
        </Row>
        <CField
          name="address"
          label="Adresse"
          value={v.address}
          onChange={set("address")}
        />
        <SubmitBtn
          idle={verified ? "Envoyer la demande" : "Enregistrer"}
          success={ok}
          successLabel={verified ? "Envoyée" : "Enregistré"}
        />
      </form>
    </Section>
  );
}
function VehicleReadonly({ v }: { v: SelfVehicle }) {
  return (
    <>
      <KV k="Type" v={lbl(VEHICLE_TYPES, v.vehicle_type)} />
      <KV
        k="Véhicule"
        v={[v.vehicle_brand, v.vehicle_model].filter(Boolean).join(" ") || null}
      />
      <KV k="Immatriculation" v={v.vehicle_plate} />
      <KV k="Couleur" v={v.vehicle_color} />
      <KV k="Année" v={v.vehicle_year ? String(v.vehicle_year) : null} />
      <KV k="N° carte d'identité" v={v.id_card_number} />
      <KV k="N° national" v={v.national_id_number} />
      <KV k="Wilaya" v={v.wilaya} />
      <KV k="Adresse" v={v.address} />
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
function DocsSection({
  documents,
  verified,
  pending,
}: {
  documents: SelfDoc[];
  verified: boolean;
  pending: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [del, startDel] = useTransition();
  const [ok, setOk] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(
    verified ? proposeDocumentChange : addDriverDocumentSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      setOk(true);
      toast.success(
        verified
          ? "Demande envoyée — en cours de vérification"
          : "Pièce ajoutée"
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
      title={`Pièces d'identité (${documents.length})`}
      badge={<StatusPill verified={verified} pending={pending} />}
    >
      {verified && pending && <PendingBanner />}
      {documents.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
          Aucune pièce.
        </p>
      )}
      {documents.map((d) => (
        <div
          key={d.id}
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
            <b>{lbl(DOC_TYPES, d.doc_type)}</b>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {d.number ?? "N° —"}
              {d.expires_at ? ` · exp. ${d.expires_at}` : ""}
            </div>
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
                Voir le scan
              </a>
            )}
          </div>
          {!verified && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("Supprimer cette pièce ?")) return;
                startDel(async () => {
                  const r = await deleteDriverDocumentSelf(d.id);
                  if (r.error) toast.error(r.error);
                  else {
                    toast.success("Supprimée");
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
              Supprimer
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
            <label style={lab}>Type *</label>
            <select name="doc_type" required style={inp} defaultValue="cni">
              {DOC_TYPES.map(([val, l]) => (
                <option key={val} value={val}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <Field name="number" label="Numéro" />
          <Row>
            <Field name="issued_at" label="Émission" type="date" />
            <Field name="expires_at" label="Expiration" type="date" />
          </Row>
          <div>
            <label style={lab}>Scan (JPG/PNG/WEBP/PDF, max 8 Mo)</label>
            <input
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              style={{ ...inp, height: "auto", padding: 8 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <SubmitBtn
              idle={verified ? "Envoyer la demande" : "Ajouter"}
              success={ok}
              successLabel={verified ? "Envoyée" : "Ajoutée"}
            />
            <button
              type="button"
              className="btnlink"
              onClick={() => setAdding(false)}
            >
              Annuler
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
          {verified ? "+ Proposer une pièce" : "+ Ajouter une pièce"}
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
        verified ? "Demande envoyée — en cours de vérification" : "Moyen ajouté"
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
      title={`Versement (${payouts.length})`}
      badge={<StatusPill verified={verified} pending={pending} />}
    >
      {verified && pending && <PendingBanner />}
      {payouts.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
          Aucun moyen de versement.
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
              {lbl(METHODS, p.method)}
              {p.is_default ? " · défaut" : ""}
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
                if (!confirm("Supprimer ce moyen ?")) return;
                startDel(async () => {
                  const r = await deleteDriverPayoutSelf(p.id);
                  if (r.error) toast.error(r.error);
                  else {
                    toast.success("Supprimé");
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
              Supprimer
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
            <label style={lab}>Moyen *</label>
            <select name="method" required style={inp} defaultValue="ccp">
              {METHODS.map(([val, l]) => (
                <option key={val} value={val}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <Field name="label" label="Libellé" />
          <Field name="account_number" label="N° de compte / CCP / RIP" />
          <Field name="account_name" label="Titulaire" />
          <label
            style={{
              display: "flex",
              gap: 8,
              fontSize: 13,
              alignItems: "center",
            }}
          >
            <input type="checkbox" name="is_default" /> Par défaut
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <SubmitBtn
              idle={verified ? "Envoyer la demande" : "Ajouter"}
              success={ok}
              successLabel={verified ? "Envoyée" : "Ajouté"}
            />
            <button
              type="button"
              className="btnlink"
              onClick={() => setAdding(false)}
            >
              Annuler
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
          {verified ? "+ Proposer un moyen" : "+ Ajouter un moyen"}
        </button>
      )}
    </Section>
  );
}

// ---------------- Historique des demandes ----------------
function RequestHistory({ requests }: { requests: SelfRequest[] }) {
  const badge = (s: string) =>
    s === "approved"
      ? { t: "Approuvée ✓", c: "var(--go)", bg: "var(--go-soft)" }
      : s === "rejected"
        ? { t: "Refusée", c: "var(--red)", bg: "var(--red-soft)" }
        : {
            t: "En cours de vérification…",
            c: "var(--amber)",
            bg: "rgba(245,158,11,.14)",
          };
  return (
    <Section title="Mes demandes" defaultOpen={false}>
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
                Réponse : {r.review_note}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}
