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
  EQUIPMENT_PRESETS,
  LEGAL_FORMS,
  type ContractEquipmentItem,
  type ContractParty,
  type ContractTerms,
  type MerchantContractRow,
} from "@/lib/types/merchant-contract";
import {
  createMerchantContract,
  getContractPrefill,
  getSignedContractUrl,
  saveContractNotes,
  terminateContract,
  uploadSignedContract,
  type ContractActionState,
} from "@/app/admin/merchants/contrats/actions";

type MerchantOpt = {
  id: string;
  name: string;
  commune: string;
  pending: boolean;
};
type Defaults = {
  commission_cash_pct: number;
  commission_online_pct: number;
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

const emptyParty = (): ContractParty => ({
  merchant_name: "",
  legal_form: LEGAL_FORMS[0],
  rc_number: "",
  nif: "",
  address: "",
  commune: "",
  wilaya: "",
  phone: "",
  email: "",
  representative: "",
});

export function ContractsManager({
  contracts,
  merchants,
  defaults,
}: {
  contracts: MerchantContractRow[];
  merchants: MerchantOpt[];
  defaults: Defaults;
}) {
  const [open, setOpen] = useState(contracts.length === 0);
  const [merchantId, setMerchantId] = useState<string>("");
  const [party, setParty] = useState<ContractParty>(emptyParty());
  const [terms, setTerms] = useState<ContractTerms>({
    commission_cash_pct: defaults.commission_cash_pct,
    commission_online_pct: defaults.commission_online_pct,
    cash_settlement_days: 7,
    payout_delay_days: 5,
    debt_cap_da: defaults.debt_cap_da,
    duration_type: "indeterminee",
    duration_months: null,
    notice_days: 30,
    effective_date: new Date().toISOString().slice(0, 10),
    sign_place: defaults.sign_place,
    equipment: { provided: false, return_required: false, items: [] },
  });
  const [notes, setNotes] = useState("");
  const [prefilling, startPrefill] = useTransition();
  const [busy, setBusy] = useState(false);
  const [formMsg, setFormMsg] = useState<{ err?: string; ok?: string }>({});

  const setP = <K extends keyof ContractParty>(k: K, v: ContractParty[K]) =>
    setParty((p) => ({ ...p, [k]: v }));
  const setT = <K extends keyof ContractTerms>(k: K, v: ContractTerms[K]) =>
    setTerms((t) => ({ ...t, [k]: v }));

  const pickMerchant = (id: string) => {
    setMerchantId(id);
    setFormMsg({});
    if (!id) return;
    startPrefill(async () => {
      const r = await getContractPrefill(id);
      if (r.error) {
        setFormMsg({ err: r.error });
        return;
      }
      setParty((p) => ({ ...p, ...r.party }));
      setTerms((t) => ({
        ...t,
        commission_cash_pct: r.commission_cash_pct ?? t.commission_cash_pct,
        commission_online_pct:
          r.commission_online_pct ?? t.commission_online_pct,
      }));
    });
  };

  const submit = async () => {
    setBusy(true);
    setFormMsg({});
    const r = await createMerchantContract({
      merchant_id: merchantId || null,
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
      ok: "Contrat émis. Le PDF s'ouvre : imprimez-le en 2 exemplaires pour signature (« lu et approuvé » + cachet).",
    });
    window.open(`/api/pdf/contrat/${r.id}`, "_blank", "noopener");
  };

  return (
    <div className="space-y-6">
      {/* ── Émission ─────────────────────────────────────────────────────── */}
      <section className="border-border bg-surface rounded-lg border p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-foreground flex items-center gap-2 text-base font-bold">
              <FilePlus2 className="text-primary-600 size-5" />
              Nouveau contrat de partenariat
            </h2>
            <p className="text-muted mt-0.5 text-sm">
              Identifiez un commerçant pour pré-remplir, ou saisissez tout
              manuellement. Le PDF généré est conforme au droit algérien
              (intermédiation loi 18-05, signature « lu et approuvé », deux
              exemplaires originaux).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
            {open ? "Réduire" : "Ouvrir"}
          </Button>
        </div>

        {open && (
          <div className="mt-4 space-y-5">
            {/* Identification rapide — recherche intelligente */}
            <div className="space-y-1.5">
              <Label htmlFor="ctr-merchant-search">
                Pré-remplir depuis un commerçant inscrit
              </Label>
              <ContractEntitySearch
                inputId="ctr-merchant-search"
                options={merchants.map((m) => ({
                  id: m.id,
                  name: m.name,
                  sub: m.commune,
                  pending: m.pending,
                }))}
                value={merchantId}
                onPick={pickMerchant}
                busy={prefilling}
                placeholder="Rechercher par nom ou commune… (vide = saisie manuelle)"
              />
            </div>

            {/* Partie commerçant */}
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="text-foreground mb-1 text-sm font-semibold">
                Le Commerçant (partie au contrat)
              </legend>
              <Field label="Raison sociale / enseigne *">
                <Input
                  value={party.merchant_name}
                  onChange={(e) => setP("merchant_name", e.target.value)}
                />
              </Field>
              <Field label="Forme juridique">
                <select
                  value={party.legal_form}
                  onChange={(e) => setP("legal_form", e.target.value)}
                  className="border-border bg-surface text-foreground focus:border-primary-500 rounded-control h-10 w-full border px-3 text-sm outline-none"
                >
                  {LEGAL_FORMS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </Field>
              <Field label="N° registre de commerce / immatriculation *">
                <Input
                  value={party.rc_number}
                  onChange={(e) => setP("rc_number", e.target.value)}
                  placeholder="RC n° …"
                />
              </Field>
              <Field label="NIF (identification fiscale)">
                <Input
                  value={party.nif}
                  onChange={(e) => setP("nif", e.target.value)}
                />
              </Field>
              <Field label="Représentant signataire (nom, qualité) *">
                <Input
                  value={party.representative}
                  onChange={(e) => setP("representative", e.target.value)}
                  placeholder="M. / Mme …, gérant(e)"
                />
              </Field>
              <Field label="Téléphone">
                <Input
                  value={party.phone}
                  onChange={(e) => setP("phone", e.target.value)}
                />
              </Field>
              <Field label="Adresse de l'établissement *">
                <Input
                  value={party.address}
                  onChange={(e) => setP("address", e.target.value)}
                />
              </Field>
              <Field label="Commune / wilaya">
                <div className="flex gap-2">
                  <Input
                    value={party.commune}
                    onChange={(e) => setP("commune", e.target.value)}
                    placeholder="Commune"
                  />
                  <Input
                    value={party.wilaya}
                    onChange={(e) => setP("wilaya", e.target.value)}
                    placeholder="Wilaya"
                    className="max-w-[120px]"
                  />
                </div>
              </Field>
              <Field label="E-mail (notifications contractuelles)">
                <Input
                  type="email"
                  value={party.email}
                  onChange={(e) => setP("email", e.target.value)}
                />
              </Field>
            </fieldset>

            {/* Conditions financières */}
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="text-foreground mb-1 text-sm font-semibold">
                Conditions financières
              </legend>
              <Field label="Commission ventes espèces (%)">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={50}
                  value={terms.commission_cash_pct}
                  onChange={(e) =>
                    setT("commission_cash_pct", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Commission ventes en ligne (%)">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={50}
                  value={terms.commission_online_pct}
                  onChange={(e) =>
                    setT("commission_online_pct", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Plafond d'endettement (DA)">
                <Input
                  type="number"
                  min={0}
                  value={terms.debt_cap_da}
                  onChange={(e) => setT("debt_cap_da", Number(e.target.value))}
                />
              </Field>
              <Field label="Reversement commissions espèces (jours)">
                <Input
                  type="number"
                  min={1}
                  value={terms.cash_settlement_days}
                  onChange={(e) =>
                    setT("cash_settlement_days", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Versement des sommes dues (jours ouvrés)">
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
                      e.target.value as ContractTerms["duration_type"]
                    )
                  }
                  className="border-border bg-surface text-foreground focus:border-primary-500 rounded-control h-10 w-full border px-3 text-sm outline-none"
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

            {/* Matériel (annexe optionnelle) */}
            <fieldset className="border-border rounded-md border p-4">
              <legend className="text-foreground px-1 text-sm font-semibold">
                Matériel remis au commerçant
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
                    Restitution exigée en fin de contrat (sinon : matériel cédé
                    au commerçant, à la valeur indiquée)
                  </label>

                  {terms.equipment.items.map((it, i) => (
                    <div
                      key={i}
                      className="border-border bg-surface-2 rounded-control grid gap-2 border p-3 sm:grid-cols-6"
                    >
                      <div className="sm:col-span-2">
                        <Input
                          list="ctr-equip-presets"
                          value={it.label}
                          placeholder="Désignation (ex. Tablette)"
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
                        className="border-border bg-surface text-foreground rounded-control h-10 border px-2 text-sm outline-none"
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
                          className="text-danger-600 hover:bg-danger-50 rounded-sm p-2"
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
                  <datalist id="ctr-equip-presets">
                    {EQUIPMENT_PRESETS.map((p) => (
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

            {/* Notes internes */}
            <Field label="Notes internes (traçabilité — n'apparaissent pas dans le PDF)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="border-border bg-surface text-foreground focus:border-primary-500 rounded-control w-full border px-3 py-2 text-sm outline-none"
              />
            </Field>

            {formMsg.err && (
              <p className="border-danger-200 bg-danger-50 text-danger-800 rounded-control border px-3 py-2.5 text-sm">
                {formMsg.err}
              </p>
            )}
            {formMsg.ok && (
              <p className="rounded-control border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
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

      {/* ── Registre des contrats ────────────────────────────────────────── */}
      <section>
        <h2 className="text-foreground mb-2 text-base font-bold">
          Registre des contrats ({contracts.length})
        </h2>
        {contracts.length === 0 ? (
          <p className="text-muted text-sm">
            Aucun contrat émis pour le moment.
          </p>
        ) : (
          <div className="space-y-3">
            {contracts.map((c) => (
              <ContractCard key={c.id} c={c} />
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

// ─────────────────────────────────────────────────────────────────────────────
// Carte d'un contrat émis : PDF, archivage du scan signé, notes, résiliation.
// ─────────────────────────────────────────────────────────────────────────────
function ContractCard({ c }: { c: MerchantContractRow }) {
  const meta = CONTRACT_STATUS_META[c.status];
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [msg, setMsg] = useState<{ err?: string; ok?: string }>({});
  const [notes, setNotes] = useState(c.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadSignedContract,
    {} as ContractActionState
  );

  const equip = c.terms.equipment;

  return (
    <article className="border-border bg-surface rounded-lg border p-4">
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
        {c.party.merchant_name}
        <span className="text-muted font-normal">
          {" "}
          — {c.party.legal_form}, RC {c.party.rc_number || "—"}
          {c.party.commune ? ` · ${c.party.commune}` : ""}
        </span>
      </p>
      <p className="text-muted mt-0.5 text-xs">
        Commissions {c.terms.commission_cash_pct}% espèces /{" "}
        {c.terms.commission_online_pct}% en ligne · plafond dette{" "}
        {da(c.terms.debt_cap_da)} · effet {dayFr(c.terms.effective_date)}
        {equip.provided
          ? ` · matériel : ${equip.items.length} article(s)${equip.return_required ? " (restituable)" : " (cédé)"}`
          : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={`/api/pdf/contrat/${c.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="border-border hover:bg-surface-2 rounded-control inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-medium"
        >
          <Download className="size-4" /> PDF du contrat
        </a>

        {c.status !== "terminated" && (
          <form
            action={uploadAction}
            className="inline-flex items-center gap-2"
          >
            <input type="hidden" name="contract_id" value={c.id} />
            <label className="border-border hover:bg-surface-2 rounded-control inline-flex cursor-pointer items-center gap-1.5 border px-3 py-1.5 text-sm font-medium">
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
                const r = await getSignedContractUrl(c.id);
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
                const r = await terminateContract(c.id, reason);
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
            className="border-border bg-surface text-foreground focus:border-primary-500 rounded-control w-full border px-3 py-2 text-sm outline-none"
          />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await saveContractNotes(c.id, notes);
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
