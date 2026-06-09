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
  submitDriverChangeRequest,
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

/** Petit spinner blanc réutilisant le keyframe mq-spin de maquette.css. */
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

/**
 * Bouton submit : loader pendant l'envoi (useFormStatus), puis VERT « ✓ … »
 * quelques secondes au succès (piloté par le parent via `success`).
 */
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
          Enregistrement…
        </>
      ) : success ? (
        `✓ ${successLabel}`
      ) : (
        idle
      )}
    </button>
  );
}

/** Section repliable (ouvrir / fermer) avec pastille d'état optionnelle. */
function Section({
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
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
          gap: 10,
          background: "none",
          border: 0,
          padding: "16px 16px",
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
  const pendingReqs = requests.filter((r) => r.status === "pending").length;
  return (
    <>
      <div className="head">
        <h1>Mes informations</h1>
      </div>

      {verified ? (
        <div
          className="card"
          style={{ borderColor: "var(--go)", marginBottom: 14 }}
        >
          <b style={{ color: "var(--go)" }}>✓ Compte vérifié</b>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Vos informations sont validées et en lecture seule. Pour toute
            modification, envoyez une demande : elle sera appliquée après
            vérification par l&apos;équipe Coligo.
          </p>
        </div>
      ) : (
        <div
          className="card"
          style={{ borderColor: "var(--violet)", marginBottom: 14 }}
        >
          <b style={{ color: "var(--violet)" }}>Complétez votre profil</b>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Renseignez votre véhicule, vos pièces et votre versement, puis
            attendez la vérification par Coligo. Une fois vérifié, le profil
            devient verrouillé.
          </p>
        </div>
      )}

      <VehicleSection vehicle={vehicle} locked={verified} />
      <DocsSection documents={documents} locked={verified} />
      <PayoutsSection payouts={payouts} locked={verified} />

      {verified && (
        <ChangeRequestSection requests={requests} pendingCount={pendingReqs} />
      )}
    </>
  );
}

// ---------------- Véhicule (contrôlé → pas de perte de valeur au submit) ----
function VehicleSection({
  vehicle,
  locked,
}: {
  vehicle: SelfVehicle;
  locked: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(vehicle);
  const set =
    (k: keyof SelfVehicle) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setV((s) => ({ ...s, [k]: e.target.value }));
  const [ok, setOk] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(
    saveDriverVehicleSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      setOk(true);
      toast.success("Véhicule & identité enregistrés");
      router.refresh();
      const t = setTimeout(() => setOk(false), 2500);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
  }, [state, router]);

  if (locked) {
    return (
      <Section title="Véhicule & identité">
        <KV k="Type" v={lbl(VEHICLE_TYPES, v.vehicle_type)} />
        <KV
          k="Véhicule"
          v={
            [v.vehicle_brand, v.vehicle_model].filter(Boolean).join(" ") || null
          }
        />
        <KV k="Immatriculation" v={v.vehicle_plate} />
        <KV k="Couleur" v={v.vehicle_color} />
        <KV k="Année" v={v.vehicle_year ? String(v.vehicle_year) : null} />
        <KV k="N° carte d'identité" v={v.id_card_number} />
        <KV k="N° national" v={v.national_id_number} />
        <KV k="Wilaya" v={v.wilaya} />
        <KV k="Adresse" v={v.address} />
      </Section>
    );
  }

  return (
    <Section title="Véhicule & identité" defaultOpen>
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
        <SubmitBtn idle="Enregistrer" success={ok} />
      </form>
    </Section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {children}
    </div>
  );
}
/** Champ CONTRÔLÉ (valeur conservée même après le reset auto du form action). */
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
/** Champ non contrôlé (pour les formulaires « ajouter » qui se ferment). */
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
  locked,
}: {
  documents: SelfDoc[];
  locked: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [del, startDel] = useTransition();
  const [ok, setOk] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(
    addDriverDocumentSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      setOk(true);
      toast.success("Pièce ajoutée");
      router.refresh();
      const t = setTimeout(() => {
        setOk(false);
        setAdding(false);
      }, 1200);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
  }, [state, router]);

  return (
    <Section title={`Pièces d'identité (${documents.length})`}>
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
          {!locked && (
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

      {locked ? null : adding ? (
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
            <SubmitBtn idle="Ajouter" success={ok} successLabel="Ajoutée" />
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
          + Ajouter une pièce
        </button>
      )}
    </Section>
  );
}

// ---------------- Versement ----------------
function PayoutsSection({
  payouts,
  locked,
}: {
  payouts: SelfPayout[];
  locked: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [del, startDel] = useTransition();
  const [ok, setOk] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(
    addDriverPayoutSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      setOk(true);
      toast.success("Moyen ajouté");
      router.refresh();
      const t = setTimeout(() => {
        setOk(false);
        setAdding(false);
      }, 1200);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
  }, [state, router]);

  return (
    <Section title={`Versement (${payouts.length})`}>
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
          {!locked && (
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

      {locked ? null : adding ? (
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
            <SubmitBtn idle="Ajouter" success={ok} successLabel="Ajouté" />
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
          + Ajouter un moyen
        </button>
      )}
    </Section>
  );
}

// ---------------- Demande de modification (vérifié) ----------------
function ChangeRequestSection({
  requests,
  pendingCount,
}: {
  requests: SelfRequest[];
  pendingCount: number;
}) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(
    submitDriverChangeRequest,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      setOk(true);
      toast.success("Demande envoyée — en attente de validation");
      router.refresh();
      const t = setTimeout(() => setOk(false), 2500);
      return () => clearTimeout(t);
    }
    if (state.error) toast.error(state.error);
  }, [state, router]);

  const badge = (s: string) =>
    s === "approved"
      ? { t: "Approuvée", c: "var(--go)", bg: "var(--go-soft)" }
      : s === "rejected"
        ? { t: "Refusée", c: "var(--red)", bg: "var(--red-soft)" }
        : { t: "En attente", c: "var(--amber)", bg: "rgba(245,158,11,.14)" };

  const headBadge =
    pendingCount > 0 ? (
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "var(--amber)",
          background: "rgba(245,158,11,.14)",
          borderRadius: 20,
          padding: "3px 9px",
        }}
      >
        {pendingCount} en attente
      </span>
    ) : undefined;

  return (
    <Section title="Demander une modification" badge={headBadge} defaultOpen>
      <form action={action} style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={lab}>Concerne</label>
          <select name="kind" style={inp} defaultValue="vehicle">
            <option value="vehicle">Véhicule</option>
            <option value="document">Pièce d&apos;identité</option>
            <option value="payout">Versement</option>
            <option value="profile">Profil</option>
            <option value="other">Autre</option>
          </select>
        </div>
        <div>
          <label style={lab}>Détail de la demande *</label>
          <textarea
            name="note"
            required
            rows={3}
            style={{ ...inp, height: "auto", padding: "10px 12px" }}
          />
        </div>
        <SubmitBtn
          idle="Envoyer la demande"
          success={ok}
          successLabel="Envoyée"
        />
      </form>

      {requests.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {requests.map((r) => {
            const b = badge(r.status);
            return (
              <div
                key={r.id}
                style={{
                  padding: "8px 0",
                  borderTop: "1px solid var(--line)",
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
        </div>
      )}
    </Section>
  );
}
