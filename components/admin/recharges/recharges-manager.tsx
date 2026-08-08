"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  MapPin,
  Plus,
  Power,
  ShieldAlert,
  Store,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { AdminDocViewer } from "@/components/admin/doc-viewer";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { formatDA } from "@/lib/utils";
import {
  approveTopup,
  createPartner,
  creditWallet,
  promoteMerchant,
  rejectTopup,
  setOperatorGating,
  setWalletStatus,
  signPartnerDocUrl,
  signWalletProofUrl,
  updateThresholds,
  uploadPartnerDoc,
} from "@/app/admin/recharges/actions";

export type PendingTopup = {
  id: string;
  walletId: string;
  ownerLabel: string;
  method: string;
  amountDa: number;
  proofUrl: string;
  createdAt: string;
};

export type PartnerDoc = {
  id: string;
  kind: string;
  url: string;
  label: string | null;
};

export type PartnerRow = {
  walletId: string;
  displayName: string;
  ownerName: string | null;
  registreCommerce: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  lat: number | null;
  lng: number | null;
  status: "active" | "suspended" | "disabled";
  balanceDa: number;
  docs: PartnerDoc[];
};

export type MerchantOption = {
  id: string;
  name: string;
  address: string | null;
};

const DOC_LABEL: Record<string, string> = {
  registre_commerce: "Registre de commerce",
  piece_identite: "Pièce d'identité",
  autre: "Autre document",
};

const STATUS_TONE: Record<
  PartnerRow["status"],
  "success" | "warning" | "danger"
> = { active: "success", suspended: "warning", disabled: "danger" };
const STATUS_LABEL: Record<PartnerRow["status"], string> = {
  active: "Actif",
  suspended: "Suspendu",
  disabled: "Désactivé",
};

function Section({
  icon,
  title,
  description,
  focus,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Code(s) d'alerte ciblant cette section (surbrillance ?focus=<code>). */
  focus?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-alert-focus={focus}
      className="border-border bg-surface rounded-lg border p-5"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="bg-primary-50 text-primary-600 flex size-9 shrink-0 items-center justify-center rounded-full">
          {icon}
        </span>
        <div>
          <h2 className="text-foreground text-base font-bold">{title}</h2>
          {description && <p className="text-muted text-sm">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function RechargesManager({
  gatingActive,
  thresholds,
  pending,
  partners,
  merchants,
}: {
  gatingActive: boolean;
  thresholds: {
    driver: number;
    chauffeur: number;
    merchant: number;
    newDays: number;
    topupMax: number;
    presets: number[];
  };
  pending: PendingTopup[];
  partners: PartnerRow[];
  merchants: MerchantOption[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useActionNote();

  const run = (
    fn: () => Promise<{ ok?: true; error?: string }>,
    okMsg: string
  ) =>
    start(async () => {
      const res = await fn();
      if (res.error) setNote({ ok: false, text: res.error });
      else {
        setNote({ ok: true, text: okMsg });
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <ActionNote note={note} />
      {/* Bandeau explicatif du flux */}
      <div className="border-primary-200 bg-primary-50 rounded-lg border p-4">
        <p className="text-primary-800 mb-2 text-sm font-bold">
          Comment fonctionne ce module
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            "Les opérateurs (livreur, chauffeur, commerçant) ont un portefeuille. Sous leur seuil, ils sont bloqués — si vous activez le blocage ci-dessous.",
            "Ils rechargent par carte, ou par virement/CCP : vous validez alors leur preuve dans la file ci-dessous.",
            "Les Agents Coligo Pay revendent du crédit en espèces. Vous les créez, activez et créditez (bonus = leur rémunération).",
            "Les seuils négatifs par rôle et le plafond de recharge se règlent en bas.",
          ].map((t, i) => (
            <div key={i} className="flex gap-2">
              <span className="bg-primary-600 text-caption flex size-5 shrink-0 items-center justify-center rounded-full font-bold text-white">
                {i + 1}
              </span>
              <p className="text-primary-900 text-xs">{t}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 1. Enforcement */}
      <Section
        icon={<Power className="size-4" />}
        title="Blocage par solde insuffisant"
        description="Quand actif, un opérateur sous son seuil ne peut plus opérer jusqu'à recharge."
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Badge tone={gatingActive ? "success" : "neutral"}>
              {gatingActive ? "Actif" : "Inactif (dormant)"}
            </Badge>
            {!gatingActive && (
              <span className="text-muted text-xs">
                Aucun blocage n’est appliqué actuellement.
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant={gatingActive ? "outline" : "default"}
            disabled={busy}
            onClick={() =>
              run(
                () => setOperatorGating(!gatingActive),
                gatingActive ? "Blocage désactivé" : "Blocage activé"
              )
            }
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {gatingActive ? "Désactiver" : "Activer"}
          </Button>
        </div>
        {!gatingActive && (
          <p className="text-warning-700 bg-warning-100 mt-3 flex items-start gap-2 rounded-md p-3 text-xs">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            N’activez le blocage qu’une fois les canaux de recharge en place,
            pour ne pas bloquer un opérateur sans moyen de se renflouer.
          </p>
        )}
      </Section>

      {/* 2. Recharges manuelles à valider */}
      <Section
        icon={<Wallet className="size-4" />}
        title="Recharges manuelles à valider"
        description="Preuves de virement / CCP en attente."
        focus="topup_pending"
      >
        {pending.length === 0 ? (
          <p className="text-muted text-sm">Aucune demande en attente.</p>
        ) : (
          <ul className="divide-border divide-y">
            {pending.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-semibold">
                    {r.ownerLabel} ·{" "}
                    <span className="tabular-nums">{formatDA(r.amountDa)}</span>
                  </p>
                  <p className="text-muted text-xs">
                    {r.method.toUpperCase()} ·{" "}
                    {new Date(r.createdAt).toLocaleDateString("fr-DZ")}
                  </p>
                </div>
                <AdminDocViewer
                  docTitle={`Preuve — ${r.ownerLabel}`}
                  triggerLabel="Voir & décider"
                  getUrl={() => signWalletProofUrl(r.proofUrl)}
                  onDecide={async (status, note) => {
                    const res =
                      status === "approved"
                        ? await approveTopup(r.id)
                        : await rejectTopup(r.id, note ?? "");
                    // Succès : la demande quitte la liste « en attente » via
                    // refresh (visuel). L'erreur est gérée par AdminDocViewer (res).
                    if (!res.error) router.refresh();
                    return res;
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 3. Agents Coligo Pay */}
      <Section
        icon={<Store className="size-4" />}
        title="Agents Coligo Pay"
        description="Agents Coligo Pay visibles dans « Où recharger » des opérateurs."
        focus="operator_wallets_negative"
      >
        <CreatePartnerForm busy={busy} run={run} merchants={merchants} />
        {partners.length === 0 ? (
          <p className="text-muted mt-4 text-sm">Aucun point pour le moment.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {partners.map((p) => (
              <PartnerItem key={p.walletId} p={p} busy={busy} run={run} />
            ))}
          </ul>
        )}
      </Section>

      {/* 4. Seuils & plafonds */}
      <Section
        icon={<MapPin className="size-4" />}
        title="Seuils négatifs & plafonds"
        description="Découvert autorisé par rôle, période « compte neuf », plafond de recharge."
      >
        <ThresholdsForm busy={busy} run={run} initial={thresholds} />
      </Section>
    </div>
  );
}

function CreatePartnerForm({
  busy,
  run,
  merchants,
}: {
  busy: boolean;
  run: (
    fn: () => Promise<{ ok?: true; error?: string }>,
    okMsg: string
  ) => void;
  merchants: MerchantOption[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "promote">("new");
  const [merchantId, setMerchantId] = useState("");
  const [merchQuery, setMerchQuery] = useState("");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [f, setF] = useState({
    displayName: "",
    ownerName: "",
    registreCommerce: "",
    address: "",
    phone: "",
    hours: "",
    loginPassword: "",
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Ajouter un point
      </Button>
    );
  }

  const filtered = merchQuery.trim()
    ? merchants.filter((m) =>
        m.name.toLowerCase().includes(merchQuery.trim().toLowerCase())
      )
    : merchants;

  return (
    <div className="border-border bg-surface-2 rounded-card-lg space-y-3 border p-4">
      {/* Choix du mode */}
      <div className="bg-surface rounded-control flex gap-1 p-1 text-sm">
        {(["new", "promote"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              mode === m
                ? "bg-primary-600 flex-1 rounded-sm px-3 py-1.5 font-semibold text-white"
                : "text-muted flex-1 rounded-sm px-3 py-1.5 font-medium"
            }
          >
            {m === "new"
              ? "Nouveau point officiel"
              : "Promouvoir un commerçant"}
          </button>
        ))}
      </div>

      {mode === "promote" ? (
        <div className="space-y-2">
          <Label>Commerçant à promouvoir en Agent Coligo Pay</Label>
          <Input
            value={merchQuery}
            onChange={(e) => setMerchQuery(e.target.value)}
            placeholder="Rechercher un commerçant…"
          />
          <div className="border-border divide-border rounded-control max-h-48 divide-y overflow-y-auto border">
            {filtered.length === 0 ? (
              <p className="text-muted p-3 text-xs">
                Aucun commerçant avec position GPS.
              </p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMerchantId(m.id)}
                  className={
                    merchantId === m.id
                      ? "bg-primary-50 flex w-full flex-col px-3 py-2 text-left"
                      : "hover:bg-surface flex w-full flex-col px-3 py-2 text-left"
                  }
                >
                  <span className="text-sm font-semibold">{m.name}</span>
                  {m.address && (
                    <span className="text-muted text-xs">{m.address}</span>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !merchantId}
              onClick={() =>
                run(
                  () => promoteMerchant(merchantId),
                  "Commerçant promu en point"
                )
              }
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Promouvoir
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="dn">Nom du commerce</Label>
            <Input
              id="dn"
              value={f.displayName}
              onChange={(e) => setF({ ...f, displayName: e.target.value })}
              placeholder="Superette El Baraka"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="on">Gérant (prénom & nom)</Label>
            <Input
              id="on"
              value={f.ownerName}
              onChange={(e) => setF({ ...f, ownerName: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rc">N° registre de commerce</Label>
            <Input
              id="rc"
              value={f.registreCommerce}
              onChange={(e) => setF({ ...f, registreCommerce: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ph">Téléphone</Label>
            <Input
              id="ph"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hr">Horaires</Label>
            <Input
              id="hr"
              value={f.hours}
              onChange={(e) => setF({ ...f, hours: e.target.value })}
              placeholder="8h-22h"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ad">Adresse</Label>
            <Input
              id="ad"
              value={f.address}
              onChange={(e) => setF({ ...f, address: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="pw">Mot de passe d&apos;accès au portail</Label>
            <Input
              id="pw"
              type="text"
              value={f.loginPassword}
              onChange={(e) => setF({ ...f, loginPassword: e.target.value })}
              placeholder="≥ 6 caractères — connexion par téléphone"
            />
            <p className="text-subtle text-xs">
              Crée le compte de l’Agent Coligo Pay (connexion sur /partenaire
              avec le téléphone ci-dessus). Laisser vide = agent passif sans
              connexion.
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Position sur la carte (recherche + clic)</Label>
            <div className="h-64 overflow-hidden rounded-md">
              <MapPositionPicker
                searchEnabled
                searchPlaceholder="Chercher une adresse, un lieu…"
                initial={pos}
                onChange={(p) => setPos({ lat: p.lat, lng: p.lng })}
              />
            </div>
            <p className="text-subtle text-xs">
              {pos
                ? `Position : ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`
                : "Aucune position sélectionnée."}
            </p>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    createPartner({
                      displayName: f.displayName,
                      ownerName: f.ownerName || undefined,
                      registreCommerce: f.registreCommerce || undefined,
                      address: f.address || undefined,
                      phone: f.phone || undefined,
                      hours: f.hours || undefined,
                      lat: pos?.lat,
                      lng: pos?.lng,
                      loginPassword: f.loginPassword || undefined,
                    }),
                  "Point créé — ajoutez ses documents ci-dessous"
                )
              }
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Créer le point
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PartnerItem({
  p,
  busy,
  run,
}: {
  p: PartnerRow;
  busy: boolean;
  run: (
    fn: () => Promise<{ ok?: true; error?: string }>,
    okMsg: string
  ) => void;
}) {
  const [credit, setCredit] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [type, setType] = useState<"topup_manual" | "bonus" | "adjustment">(
    "bonus"
  );
  const [docsOpen, setDocsOpen] = useState(false);
  const [docKind, setDocKind] = useState("registre_commerce");
  const [docFile, setDocFile] = useState<File | null>(null);
  const router = useRouter();
  const [uploading, startUpload] = useTransition();
  const [fb, setFb] = useActionNote();
  const doUpload = () => {
    if (!docFile) return;
    const fd = new FormData();
    fd.set("wallet_id", p.walletId);
    fd.set("kind", docKind);
    fd.set("file", docFile);
    startUpload(async () => {
      const res = await uploadPartnerDoc(fd);
      // Succès : le document apparaît dans la liste via refresh (visuel).
      if (res.error) setFb({ ok: false, text: res.error });
      else {
        setDocFile(null);
        router.refresh();
      }
    });
  };
  return (
    <li className="border-border rounded-card-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
            {p.displayName}
            <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
          </p>
          {p.address && <p className="text-muted text-xs">{p.address}</p>}
          {(p.ownerName || p.registreCommerce) && (
            <p className="text-muted text-xs">
              {p.ownerName ?? ""}
              {p.ownerName && p.registreCommerce ? " · " : ""}
              {p.registreCommerce ? `RC ${p.registreCommerce}` : ""}
            </p>
          )}
          <p className="text-subtle mt-0.5 text-xs">
            Solde :{" "}
            <span className="tabular-nums">{formatDA(p.balanceDa)}</span>
            {p.phone ? ` · ${p.phone}` : ""}
            {p.lat != null && p.lng != null
              ? ` · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.status !== "active" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => setWalletStatus(p.walletId, "active"), "Réactivé")
              }
            >
              Activer
            </Button>
          )}
          {p.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => setWalletStatus(p.walletId, "suspended"), "Suspendu")
              }
            >
              Suspendre
            </Button>
          )}
          {p.status !== "disabled" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => setWalletStatus(p.walletId, "disabled"), "Désactivé")
              }
            >
              Désactiver
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDocsOpen(!docsOpen)}
          >
            Documents{p.docs.length ? ` (${p.docs.length})` : ""}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCredit(!credit)}>
            <Plus className="size-4" /> Créditer
          </Button>
        </div>
      </div>

      {docsOpen && (
        <div className="bg-surface-2 mt-3 space-y-2 rounded-md p-3">
          {p.docs.length === 0 ? (
            <p className="text-muted text-xs">Aucune pièce justificative.</p>
          ) : (
            <ul className="space-y-1">
              {p.docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {DOC_LABEL[d.kind] ?? d.kind}
                    {d.label ? ` · ${d.label}` : ""}
                  </span>
                  <AdminDocViewer
                    docTitle={DOC_LABEL[d.kind] ?? "Document"}
                    triggerLabel="Voir"
                    getUrl={() => signPartnerDocUrl(d.url)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={docKind}
              onChange={(e) => setDocKind(e.target.value)}
              className="border-border bg-surface rounded-control border px-2 py-1.5 text-sm"
            >
              <option value="registre_commerce">Registre de commerce</option>
              <option value="piece_identite">Pièce d&apos;identité</option>
              <option value="autre">Autre</option>
            </select>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <Button
              size="sm"
              disabled={uploading || !docFile}
              onClick={doUpload}
            >
              {uploading && <Loader2 className="size-4 animate-spin" />}
              Téléverser
            </Button>
          </div>
          <ActionNote note={fb} className="mt-2" />
        </div>
      )}
      {credit && (
        <div className="bg-surface-2 mt-3 grid gap-2 rounded-md p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Montant DA"
            inputMode="numeric"
          />
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as "topup_manual" | "bonus" | "adjustment")
            }
            className="border-border bg-surface rounded-control border px-2 text-sm"
          >
            <option value="bonus">Bonus</option>
            <option value="topup_manual">Recharge</option>
            <option value="adjustment">Ajustement</option>
          </select>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  creditWallet({
                    walletId: p.walletId,
                    amountDa: Number(amount),
                    type,
                    note,
                  }),
                "Crédité"
              )
            }
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Valider
          </Button>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optionnel)"
            className="sm:col-span-3"
          />
        </div>
      )}
    </li>
  );
}

function ThresholdsForm({
  busy,
  run,
  initial,
}: {
  busy: boolean;
  run: (
    fn: () => Promise<{ ok?: true; error?: string }>,
    okMsg: string
  ) => void;
  initial: {
    driver: number;
    chauffeur: number;
    merchant: number;
    newDays: number;
    topupMax: number;
    presets: number[];
  };
}) {
  const { presets: initialPresets, ...initialNums } = initial;
  const [v, setV] = useState(initialNums);
  const [presetsStr, setPresetsStr] = useState(initialPresets.join(", "));
  const num = (k: keyof typeof v) => ({
    value: String(v[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setV({ ...v, [k]: Number(e.target.value) || 0 }),
    inputMode: "numeric" as const,
  });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="t1">Découvert livreur (DA)</Label>
        <Input id="t1" {...num("driver")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="t2">Découvert chauffeur (DA)</Label>
        <Input id="t2" {...num("chauffeur")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="t3">Découvert commerçant (DA)</Label>
        <Input id="t3" {...num("merchant")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="t4">Compte neuf : 0 DA pendant (jours)</Label>
        <Input id="t4" {...num("newDays")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="t5">Plafond de recharge (DA)</Label>
        <Input id="t5" {...num("topupMax")} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="t6">
          Montants suggérés (chips, séparés par virgule)
        </Label>
        <Input
          id="t6"
          value={presetsStr}
          onChange={(e) => setPresetsStr(e.target.value)}
          placeholder="500, 1000, 2000, 5000"
        />
      </div>
      <div className="flex items-end">
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                updateThresholds({
                  driver: v.driver,
                  chauffeur: v.chauffeur,
                  merchant: v.merchant,
                  newDays: v.newDays,
                  topupMax: v.topupMax,
                  presets: presetsStr
                    .split(/[,\s]+/)
                    .map((s) => Number(s.trim()))
                    .filter((n) => Number.isFinite(n) && n > 0),
                }),
              "Seuils enregistrés"
            )
          }
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          <CheckCircle2 className="size-4" /> Enregistrer
        </Button>
      </div>
    </div>
  );
}
