"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Download,
  Eye,
  FilePlus2,
  FileSignature,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import { ContractEntitySearch } from "@/components/admin/contract-entity-search";
import { cn } from "@/lib/utils";
import {
  CONTRACT_STATUS_META,
  EQUIPMENT_CONDITIONS,
  type ContractEquipmentItem,
} from "@/lib/types/merchant-contract";
import {
  PARTNER_EQUIPMENT_PRESETS,
  PARTNER_KIND_META,
  PARTNER_WORK_STATUS,
  type PartnerContractRow,
  type PartnerKind,
  type PartnerParty,
  type PartnerTerms,
} from "@/lib/types/partner-contract";
import {
  createPartnerContract,
  getPartnerContractPrefill,
  getSignedPartnerContractUrl,
  savePartnerContractNotes,
  terminatePartnerContract,
  uploadSignedPartnerContract,
  type PartnerContractActionState,
} from "@/app/admin/partner-contracts-actions";

type PartnerOpt = { id: string; name: string; sub: string; pending: boolean };
type Defaults = {
  fee_pct: number;
  float_cap_da: number;
  debt_cap_da: number;
  sign_place: string;
};

const dayFr = (iso: string | null) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
const da = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " DA";

const emptyItem = (): ContractEquipmentItem => ({
  label: "",
  qty: 1,
  unit_cost_da: 0,
  condition: "Neuf",
  serial: "",
  notes: "",
});

const emptyParty = (): PartnerParty => ({
  full_name: "",
  id_number: "",
  license_number: "",
  work_status: PARTNER_WORK_STATUS[0],
  registration_number: "",
  address: "",
  wilaya: "",
  phone: "",
  email: "",
  vehicle_type: "",
  vehicle_brand: "",
  vehicle_model: "",
  vehicle_plate: "",
});

export function PartnerContractsManager({
  kind,
  contracts,
  partners,
  defaults,
}: {
  kind: PartnerKind;
  contracts: PartnerContractRow[];
  partners: PartnerOpt[];
  defaults: Defaults;
}) {
  const meta = PARTNER_KIND_META[kind];
  const [open, setOpen] = useState(contracts.length === 0);
  const [partnerId, setPartnerId] = useState("");
  const [party, setParty] = useState<PartnerParty>(emptyParty());
  const [terms, setTerms] = useState<PartnerTerms>({
    fee_pct: defaults.fee_pct,
    float_cap_da: defaults.float_cap_da,
    debt_cap_da: defaults.debt_cap_da,
    settlement_days: 7,
    payout_delay_days: 5,
    duration_type: "indeterminee",
    duration_months: null,
    notice_days: 15,
    effective_date: new Date().toISOString().slice(0, 10),
    sign_place: defaults.sign_place,
    equipment: { provided: false, return_required: false, items: [] },
  });
  const [notes, setNotes] = useState("");
  const [prefilling, startPrefill] = useTransition();
  const [busy, setBusy] = useState(false);
  const [formMsg, setFormMsg] = useState<{ err?: string; ok?: string }>({});

  const setP = <K extends keyof PartnerParty>(k: K, v: PartnerParty[K]) =>
    setParty((p) => ({ ...p, [k]: v }));
  const setT = <K extends keyof PartnerTerms>(k: K, v: PartnerTerms[K]) =>
    setTerms((t) => ({ ...t, [k]: v }));

  const pickPartner = (id: string) => {
    setPartnerId(id);
    setFormMsg({});
    if (!id) return;
    startPrefill(async () => {
      const r = await getPartnerContractPrefill(kind, id);
      if (r.error) {
        setFormMsg({ err: r.error });
        return;
      }
      setParty((p) => ({ ...p, ...r.party }));
    });
  };

  const submit = async () => {
    setBusy(true);
    setFormMsg({});
    const r = await createPartnerContract({
      kind,
      partner_id: partnerId || null,
      party,
      terms,
      notes,
    });
    setBusy(false);
    if (r.error) {
      setFormMsg({ err: r.error });
      return;
    }
    setFormMsg({
      ok: "Contrat émis. Le PDF s'ouvre : imprimez-le en 2 exemplaires pour signature (« lu et approuvé »).",
    });
    window.open(`/api/pdf/contrat-partenaire/${r.id}`, "_blank", "noopener");
  };

  return (
    <div className="space-y-6">
      {/* ── Émission ─────────────────────────────────────────────────────── */}
      <section className="border-border bg-surface rounded-[16px] border p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-foreground flex items-center gap-2 text-base font-bold">
              <FilePlus2 className="text-primary-600 size-5" />
              Nouveau contrat de partenariat {meta.label}
            </h2>
            <p className="text-muted mt-0.5 text-sm">
              Identifiez un {meta.label} pour pré-remplir, ou saisissez tout
              manuellement. PDF conforme au droit algérien (prestataire
              indépendant, signature « lu et approuvé », deux exemplaires
              originaux).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
            {open ? "Réduire" : "Ouvrir"}
          </Button>
        </div>

        {open && (
          <div className="mt-4 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="ptn-search">
                Pré-remplir depuis un {meta.label} inscrit
              </Label>
              <ContractEntitySearch
                inputId="ptn-search"
                options={partners}
                value={partnerId}
                onPick={pickPartner}
                busy={prefilling}
                placeholder="Rechercher par nom, wilaya ou téléphone… (vide = saisie manuelle)"
              />
            </div>

            {/* Partie partenaire */}
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="text-foreground mb-1 text-sm font-semibold">
                Le {meta.role} (partie au contrat)
              </legend>
              <Field label="Nom complet *">
                <Input
                  value={party.full_name}
                  onChange={(e) => setP("full_name", e.target.value)}
                />
              </Field>
              <Field label="N° pièce d'identité (CNI) *">
                <Input
                  value={party.id_number}
                  onChange={(e) => setP("id_number", e.target.value)}
                />
              </Field>
              <Field label="N° permis de conduire *">
                <Input
                  value={party.license_number}
                  onChange={(e) => setP("license_number", e.target.value)}
                />
              </Field>
              <Field label="Statut d'exercice">
                <select
                  value={party.work_status}
                  onChange={(e) => setP("work_status", e.target.value)}
                  className="border-border bg-surface text-foreground focus:border-primary-500 h-10 w-full rounded-[10px] border px-3 text-sm outline-none"
                >
                  {PARTNER_WORK_STATUS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Immatriculation pro (auto-entrepreneur / RC, si existante)">
                <Input
                  value={party.registration_number}
                  onChange={(e) => setP("registration_number", e.target.value)}
                />
              </Field>
              <Field label="Téléphone">
                <Input
                  value={party.phone}
                  onChange={(e) => setP("phone", e.target.value)}
                />
              </Field>
              <Field label="Adresse *">
                <Input
                  value={party.address}
                  onChange={(e) => setP("address", e.target.value)}
                />
              </Field>
              <Field label="Wilaya">
                <Input
                  value={party.wilaya}
                  onChange={(e) => setP("wilaya", e.target.value)}
                />
              </Field>
              <Field label="E-mail (notifications contractuelles)">
                <Input
                  type="email"
                  value={party.email}
                  onChange={(e) => setP("email", e.target.value)}
                />
              </Field>
            </fieldset>

            {/* Véhicule */}
            <fieldset className="grid gap-3 sm:grid-cols-4">
              <legend className="text-foreground mb-1 text-sm font-semibold">
                Véhicule déclaré
              </legend>
              <Field label="Type / gamme">
                <Input
                  value={party.vehicle_type}
                  onChange={(e) => setP("vehicle_type", e.target.value)}
                  placeholder={
                    kind === "driver" ? "Moto, voiture…" : "Berline…"
                  }
                />
              </Field>
              <Field label="Marque">
                <Input
                  value={party.vehicle_brand}
                  onChange={(e) => setP("vehicle_brand", e.target.value)}
                />
              </Field>
              <Field label="Modèle">
                <Input
                  value={party.vehicle_model}
                  onChange={(e) => setP("vehicle_model", e.target.value)}
                />
              </Field>
              <Field label="Immatriculation *">
                <Input
                  value={party.vehicle_plate}
                  onChange={(e) => setP("vehicle_plate", e.target.value)}
                />
              </Field>
            </fieldset>

            {/* Conditions financières */}
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="text-foreground mb-1 text-sm font-semibold">
                Conditions financières
              </legend>
              <Field
                label={`Frais de service Coligo (%) par ${kind === "driver" ? "livraison" : "course"}`}
              >
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={50}
                  value={terms.fee_pct}
                  onChange={(e) => setT("fee_pct", Number(e.target.value))}
                />
              </Field>
              {kind === "driver" && (
                <Field label="Plafond de fonds détenus (DA)">
                  <Input
                    type="number"
                    min={0}
                    value={terms.float_cap_da}
                    onChange={(e) =>
                      setT("float_cap_da", Number(e.target.value))
                    }
                  />
                </Field>
              )}
              <Field label="Plafond de dette avant gel (DA)">
                <Input
                  type="number"
                  min={0}
                  value={terms.debt_cap_da}
                  onChange={(e) => setT("debt_cap_da", Number(e.target.value))}
                />
              </Field>
              <Field label="Cycle de règlement des sommes dues (jours)">
                <Input
                  type="number"
                  min={1}
                  value={terms.settlement_days}
                  onChange={(e) =>
                    setT("settlement_days", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Versement des gains (jours ouvrés)">
                <Input
                  type="number"
                  min={1}
                  value={terms.payout_delay_days}
                  onChange={(e) =>
                    setT("payout_delay_days", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Préavis de résiliation (jours)">
                <Input
                  type="number"
                  min={0}
                  value={terms.notice_days}
                  onChange={(e) => setT("notice_days", Number(e.target.value))}
                />
              </Field>
            </fieldset>

            {/* Durée et signature */}
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="text-foreground mb-1 text-sm font-semibold">
                Durée et signature
              </legend>
              <Field label="Durée">
                <select
                  value={terms.duration_type}
                  onChange={(e) =>
                    setT(
                      "duration_type",
                      e.target.value as PartnerTerms["duration_type"]
                    )
                  }
                  className="border-border bg-surface text-foreground focus:border-primary-500 h-10 w-full rounded-[10px] border px-3 text-sm outline-none"
                >
                  <option value="indeterminee">Indéterminée</option>
                  <option value="determinee">
                    Déterminée (renouvelable tacitement)
                  </option>
                </select>
              </Field>
              {terms.duration_type === "determinee" && (
                <Field label="Durée (mois)">
                  <Input
                    type="number"
                    min={1}
                    value={terms.duration_months ?? 12}
                    onChange={(e) =>
                      setT("duration_months", Number(e.target.value))
                    }
                  />
                </Field>
              )}
              <Field label="Date d'effet">
                <Input
                  type="date"
                  value={terms.effective_date}
                  onChange={(e) => setT("effective_date", e.target.value)}
                />
              </Field>
              <Field label="Lieu de signature">
                <Input
                  value={terms.sign_place}
                  onChange={(e) => setT("sign_place", e.target.value)}
                />
              </Field>
            </fieldset>

            {/* Matériel */}
            <fieldset className="border-border rounded-[12px] border p-4">
              <legend className="text-foreground px-1 text-sm font-semibold">
                Matériel remis au {meta.label}
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={terms.equipment.provided}
                  onChange={(e) =>
                    setT("equipment", {
                      ...terms.equipment,
                      provided: e.target.checked,
                      items:
                        e.target.checked && terms.equipment.items.length === 0
                          ? [emptyItem()]
                          : terms.equipment.items,
                    })
                  }
                />
                Du matériel est remis avec ce contrat (par défaut : aucun)
              </label>

              {terms.equipment.provided && (
                <div className="mt-3 space-y-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={terms.equipment.return_required}
                      onChange={(e) =>
                        setT("equipment", {
                          ...terms.equipment,
                          return_required: e.target.checked,
                        })
                      }
                    />
                    Restitution exigée en fin de contrat (sinon : matériel cédé,
                    à la valeur indiquée)
                  </label>

                  {terms.equipment.items.map((it, i) => (
                    <div
                      key={i}
                      className="border-border bg-surface-2 grid gap-2 rounded-[10px] border p-3 sm:grid-cols-6"
                    >
                      <div className="sm:col-span-2">
                        <Input
                          list="ptn-equip-presets"
                          value={it.label}
                          placeholder="Désignation (ex. Sac isotherme)"
                          onChange={(e) => {
                            const items = [...terms.equipment.items];
                            items[i] = { ...it, label: e.target.value };
                            setT("equipment", { ...terms.equipment, items });
                          }}
                        />
                      </div>
                      <Input
                        type="number"
                        min={1}
                        value={it.qty}
                        title="Quantité"
                        onChange={(e) => {
                          const items = [...terms.equipment.items];
                          items[i] = { ...it, qty: Number(e.target.value) };
                          setT("equipment", { ...terms.equipment, items });
                        }}
                      />
                      <Input
                        type="number"
                        min={0}
                        value={it.unit_cost_da}
                        title="Valeur unitaire (DA)"
                        placeholder="Valeur DA"
                        onChange={(e) => {
                          const items = [...terms.equipment.items];
                          items[i] = {
                            ...it,
                            unit_cost_da: Number(e.target.value),
                          };
                          setT("equipment", { ...terms.equipment, items });
                        }}
                      />
                      <select
                        value={it.condition}
                        onChange={(e) => {
                          const items = [...terms.equipment.items];
                          items[i] = { ...it, condition: e.target.value };
                          setT("equipment", { ...terms.equipment, items });
                        }}
                        className="border-border bg-surface text-foreground h-10 rounded-[10px] border px-2 text-sm outline-none"
                      >
                        {EQUIPMENT_CONDITIONS.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <Input
                          value={it.serial}
                          placeholder="N° série / IMEI"
                          onChange={(e) => {
                            const items = [...terms.equipment.items];
                            items[i] = { ...it, serial: e.target.value };
                            setT("equipment", { ...terms.equipment, items });
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Retirer ce matériel"
                          className="text-danger-600 hover:bg-danger-50 rounded-[8px] p-2"
                          onClick={() =>
                            setT("equipment", {
                              ...terms.equipment,
                              items: terms.equipment.items.filter(
                                (_, j) => j !== i
                              ),
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="sm:col-span-6">
                        <Input
                          value={it.notes}
                          placeholder="Notes (accessoires, défauts constatés…)"
                          onChange={(e) => {
                            const items = [...terms.equipment.items];
                            items[i] = { ...it, notes: e.target.value };
                            setT("equipment", { ...terms.equipment, items });
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <datalist id="ptn-equip-presets">
                    {PARTNER_EQUIPMENT_PRESETS[kind].map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setT("equipment", {
                        ...terms.equipment,
                        items: [...terms.equipment.items, emptyItem()],
                      })
                    }
                  >
                    <Plus className="size-4" /> Ajouter un matériel
                  </Button>
                </div>
              )}
            </fieldset>

            <Field label="Notes internes (traçabilité — n'apparaissent pas dans le PDF)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="border-border bg-surface text-foreground focus:border-primary-500 w-full rounded-[10px] border px-3 py-2 text-sm outline-none"
              />
            </Field>

            {formMsg.err && (
              <p className="border-danger-200 bg-danger-50 text-danger-800 rounded-[10px] border px-3 py-2.5 text-sm">
                {formMsg.err}
              </p>
            )}
            {formMsg.ok && (
              <p className="rounded-[10px] border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
                {formMsg.ok}
              </p>
            )}

            <Button onClick={submit} disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSignature className="size-4" />
              )}
              Émettre le contrat et ouvrir le PDF
            </Button>
          </div>
        )}
      </section>

      {/* ── Registre ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-foreground mb-2 text-base font-bold">
          Registre des contrats {meta.label}s ({contracts.length})
        </h2>
        {contracts.length === 0 ? (
          <p className="text-muted text-sm">
            Aucun contrat émis pour le moment.
          </p>
        ) : (
          <div className="space-y-3">
            {contracts.map((c) => (
              <PartnerContractCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function PartnerContractCard({ c }: { c: PartnerContractRow }) {
  const meta = CONTRACT_STATUS_META[c.status];
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [msg, setMsg] = useState<{ err?: string; ok?: string }>({});
  const [notes, setNotes] = useState(c.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadSignedPartnerContract,
    {} as PartnerContractActionState
  );

  const equip = c.terms.equipment;

  return (
    <article className="border-border bg-surface rounded-[16px] border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-foreground font-mono text-sm font-bold">
          {c.contract_number}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold",
            meta.tone === "success" && "bg-green-100 text-green-800",
            meta.tone === "info" && "bg-primary-50 text-primary-700",
            meta.tone === "danger" && "bg-danger-50 text-danger-700"
          )}
        >
          {meta.label}
        </span>
        <span className="text-muted text-xs">
          émis le {dayFr(c.created_at)}
          {c.signed_at ? ` · signé le ${dayFr(c.signed_at)}` : ""}
          {c.terminated_at ? ` · résilié le ${dayFr(c.terminated_at)}` : ""}
        </span>
      </div>

      <p className="text-foreground mt-1 text-sm font-semibold">
        {c.party.full_name}
        <span className="text-muted font-normal">
          {" "}
          — CNI {c.party.id_number || "—"} · véhicule{" "}
          {c.party.vehicle_plate || "—"}
          {c.party.wilaya ? ` · ${c.party.wilaya}` : ""}
        </span>
      </p>
      <p className="text-muted mt-0.5 text-xs">
        Frais de service {c.terms.fee_pct}% · plafond dette{" "}
        {da(c.terms.debt_cap_da)} · effet {dayFr(c.terms.effective_date)}
        {equip.provided
          ? ` · matériel : ${equip.items.length} article(s)${equip.return_required ? " (restituable)" : " (cédé)"}`
          : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={`/api/pdf/contrat-partenaire/${c.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="border-border hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-sm font-medium"
        >
          <Download className="size-4" /> PDF du contrat
        </a>

        {c.status !== "terminated" && (
          <form
            action={uploadAction}
            className="inline-flex items-center gap-2"
          >
            <input type="hidden" name="contract_id" value={c.id} />
            <label className="border-border hover:bg-surface-2 inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-sm font-medium">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {c.signed_file_path
                ? "Remplacer le scan signé"
                : "Archiver le scan signé"}
              <input
                type="file"
                name="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              />
            </label>
          </form>
        )}

        {c.signed_file_path && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await getSignedPartnerContractUrl(c.id);
                if (r.error) setMsg({ err: r.error });
                else window.open(r.url, "_blank", "noopener");
              })
            }
          >
            <Eye className="size-4" /> Voir le scan signé
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setNotesOpen((v) => !v)}
        >
          Notes
        </Button>

        {c.status !== "terminated" && (
          <Button
            variant="outline"
            size="sm"
            className="text-danger-600"
            disabled={pending}
            onClick={async () => {
              const reason = await prompt({
                title: `Résilier ${c.contract_number} ?`,
                message:
                  "Motif de résiliation (tracé dans le registre). Le matériel restituable devra être récupéré conformément au contrat.",
                placeholder: "Motif…",
                multiline: true,
              });
              if (reason === null) return;
              const ok = await confirm({
                title: "Confirmer la résiliation",
                message:
                  "Le contrat passera au statut « Résilié » — action tracée, irréversible.",
                confirmLabel: "Résilier",
                danger: true,
              });
              if (!ok) return;
              startTransition(async () => {
                const r = await terminatePartnerContract(c.id, reason);
                setMsg(r.error ? { err: r.error } : { ok: r.success });
              });
            }}
          >
            Résilier
          </Button>
        )}
      </div>

      {notesOpen && (
        <div className="mt-3 space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Notes de suivi (état du matériel, relances, litiges…)"
            className="border-border bg-surface text-foreground focus:border-primary-500 w-full rounded-[10px] border px-3 py-2 text-sm outline-none"
          />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await savePartnerContractNotes(c.id, notes);
                setMsg(r.error ? { err: r.error } : { ok: r.success });
              })
            }
          >
            Enregistrer les notes
          </Button>
        </div>
      )}

      {(msg.err || uploadState.error) && (
        <p className="text-danger-700 mt-2 text-sm">
          {msg.err ?? uploadState.error}
        </p>
      )}
      {(msg.ok || uploadState.success) && (
        <p className="mt-2 text-sm text-green-700">
          {msg.ok ?? uploadState.success}
        </p>
      )}
    </article>
  );
}
