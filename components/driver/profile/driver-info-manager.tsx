"use client";

import {
  useActionState,
  useEffect,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
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

      {verified && <ChangeRequestSection requests={requests} />}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2
        className="mq-sora"
        style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}
      >
        {title}
      </h2>
      {children}
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

// ---------------- Véhicule ----------------
function VehicleSection({
  vehicle,
  locked,
}: {
  vehicle: SelfVehicle;
  locked: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveDriverVehicleSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      toast.success("Véhicule & identité enregistrés");
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router]);

  if (locked) {
    return (
      <Section title="Véhicule & identité">
        <KV k="Type" v={lbl(VEHICLE_TYPES, vehicle.vehicle_type)} />
        <KV
          k="Véhicule"
          v={
            [vehicle.vehicle_brand, vehicle.vehicle_model]
              .filter(Boolean)
              .join(" ") || null
          }
        />
        <KV k="Immatriculation" v={vehicle.vehicle_plate} />
        <KV k="Couleur" v={vehicle.vehicle_color} />
        <KV
          k="Année"
          v={vehicle.vehicle_year ? String(vehicle.vehicle_year) : null}
        />
        <KV k="N° carte d'identité" v={vehicle.id_card_number} />
        <KV k="N° national" v={vehicle.national_id_number} />
        <KV k="Wilaya" v={vehicle.wilaya} />
        <KV k="Adresse" v={vehicle.address} />
      </Section>
    );
  }

  return (
    <Section title="Véhicule & identité">
      <form action={action} style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={lab}>Type de véhicule</label>
          <select
            name="vehicle_type"
            defaultValue={vehicle.vehicle_type ?? ""}
            style={inp}
          >
            <option value="">—</option>
            {VEHICLE_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <Row>
          <Field
            name="vehicle_brand"
            label="Marque"
            def={vehicle.vehicle_brand}
          />
          <Field
            name="vehicle_model"
            label="Modèle"
            def={vehicle.vehicle_model}
          />
        </Row>
        <Row>
          <Field
            name="vehicle_plate"
            label="Immatriculation"
            def={vehicle.vehicle_plate}
          />
          <Field
            name="vehicle_color"
            label="Couleur"
            def={vehicle.vehicle_color}
          />
        </Row>
        <Row>
          <Field
            name="vehicle_year"
            label="Année"
            type="number"
            def={vehicle.vehicle_year ? String(vehicle.vehicle_year) : null}
          />
          <Field name="wilaya" label="Wilaya" def={vehicle.wilaya} />
        </Row>
        <Row>
          <Field
            name="id_card_number"
            label="N° carte d'identité"
            def={vehicle.id_card_number}
          />
          <Field
            name="national_id_number"
            label="N° national"
            def={vehicle.national_id_number}
          />
        </Row>
        <Field name="address" label="Adresse" def={vehicle.address} />
        <button className="mq-btn" type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
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
function Field({
  name,
  label,
  def,
  type = "text",
}: {
  name: string;
  label: string;
  def: string | null;
  type?: string;
}) {
  return (
    <div>
      <label style={lab}>{label}</label>
      <input name={name} type={type} defaultValue={def ?? ""} style={inp} />
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
  const [state, action, pending] = useActionState<ActionState, FormData>(
    addDriverDocumentSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      toast.success("Pièce ajoutée");
      setAdding(false);
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router]);

  return (
    <Section title="Pièces d'identité">
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
              {DOC_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <Field name="number" label="Numéro" def={null} />
          <Row>
            <Field name="issued_at" label="Émission" def={null} type="date" />
            <Field
              name="expires_at"
              label="Expiration"
              def={null}
              type="date"
            />
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
            <button className="mq-btn" type="submit" disabled={pending}>
              {pending ? "Ajout…" : "Ajouter"}
            </button>
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
  const [state, action, pending] = useActionState<ActionState, FormData>(
    addDriverPayoutSelf,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      toast.success("Moyen ajouté");
      setAdding(false);
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router]);

  return (
    <Section title="Versement">
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
              {METHODS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <Field name="label" label="Libellé" def={null} />
          <Field
            name="account_number"
            label="N° de compte / CCP / RIP"
            def={null}
          />
          <Field name="account_name" label="Titulaire" def={null} />
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
            <button className="mq-btn" type="submit" disabled={pending}>
              {pending ? "Ajout…" : "Ajouter"}
            </button>
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
function ChangeRequestSection({ requests }: { requests: SelfRequest[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    submitDriverChangeRequest,
    {}
  );
  useEffect(() => {
    if (state.ok) {
      toast.success("Demande envoyée — en attente de validation");
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state, router]);

  const badge = (s: string) =>
    s === "approved"
      ? { t: "Approuvée", c: "var(--go)" }
      : s === "rejected"
        ? { t: "Refusée", c: "var(--red)" }
        : { t: "En attente", c: "var(--muted)" };

  return (
    <Section title="Demander une modification">
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
        <button className="mq-btn" type="submit" disabled={pending}>
          {pending ? "Envoi…" : "Envoyer la demande"}
        </button>
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
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <b>{r.kind}</b>
                  <span style={{ color: b.c, fontWeight: 700, fontSize: 12 }}>
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
