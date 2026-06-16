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
import { toast } from "@/components/ui/toast";
import { AdminDocViewer } from "@/components/admin/doc-viewer";
import { formatDA } from "@/lib/utils";
import {
  approveTopup,
  createPartner,
  creditWallet,
  rejectTopup,
  setOperatorGating,
  setWalletStatus,
  signWalletProofUrl,
  updateThresholds,
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

export type PartnerRow = {
  walletId: string;
  displayName: string;
  address: string | null;
  phone: string | null;
  hours: string | null;
  status: "active" | "suspended" | "disabled";
  balanceDa: number;
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
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-surface rounded-[16px] border p-5">
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
}: {
  gatingActive: boolean;
  thresholds: {
    driver: number;
    chauffeur: number;
    merchant: number;
    newDays: number;
    topupMax: number;
  };
  pending: PendingTopup[];
  partners: PartnerRow[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  const run = (
    fn: () => Promise<{ ok?: true; error?: string }>,
    okMsg: string
  ) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        toast.success(okMsg);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
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
          <p className="text-warning-700 bg-warning-100 mt-3 flex items-start gap-2 rounded-[12px] p-3 text-xs">
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
                    if (!res.error) {
                      toast.success(
                        status === "approved"
                          ? "Recharge créditée"
                          : "Demande refusée"
                      );
                      router.refresh();
                    }
                    return res;
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 3. Points de recharge */}
      <Section
        icon={<Store className="size-4" />}
        title="Points de recharge"
        description="Partenaires visibles dans « Où recharger » des opérateurs."
      >
        <CreatePartnerForm busy={busy} run={run} />
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
}: {
  busy: boolean;
  run: (
    fn: () => Promise<{ ok?: true; error?: string }>,
    okMsg: string
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    displayName: "",
    address: "",
    phone: "",
    hours: "",
    lat: "",
    lng: "",
    promotePhone: "",
  });
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Ajouter un point
      </Button>
    );
  }
  return (
    <div className="border-border bg-surface-2 grid gap-3 rounded-[14px] border p-4 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="dn">Nom du point</Label>
        <Input
          id="dn"
          value={f.displayName}
          onChange={(e) => setF({ ...f, displayName: e.target.value })}
          placeholder="Superette El Baraka"
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
      <div className="space-y-1">
        <Label htmlFor="la">Latitude</Label>
        <Input
          id="la"
          value={f.lat}
          onChange={(e) => setF({ ...f, lat: e.target.value })}
          inputMode="decimal"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ln">Longitude</Label>
        <Input
          id="ln"
          value={f.lng}
          onChange={(e) => setF({ ...f, lng: e.target.value })}
          inputMode="decimal"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="pp">
          Ou promouvoir un opérateur existant (téléphone livreur/chauffeur)
        </Label>
        <Input
          id="pp"
          value={f.promotePhone}
          onChange={(e) => setF({ ...f, promotePhone: e.target.value })}
          placeholder="+213…"
        />
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
                  address: f.address || undefined,
                  phone: f.phone || undefined,
                  hours: f.hours || undefined,
                  lat: f.lat ? Number(f.lat) : undefined,
                  lng: f.lng ? Number(f.lng) : undefined,
                  promotePhone: f.promotePhone || undefined,
                }),
              "Point ajouté"
            )
          }
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Enregistrer
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
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
  return (
    <li className="border-border rounded-[14px] border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
            {p.displayName}
            <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
          </p>
          {p.address && <p className="text-muted text-xs">{p.address}</p>}
          <p className="text-subtle mt-0.5 text-xs">
            Solde :{" "}
            <span className="tabular-nums">{formatDA(p.balanceDa)}</span>
            {p.phone ? ` · ${p.phone}` : ""}
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
          <Button size="sm" variant="ghost" onClick={() => setCredit(!credit)}>
            <Plus className="size-4" /> Créditer
          </Button>
        </div>
      </div>
      {credit && (
        <div className="bg-surface-2 mt-3 grid gap-2 rounded-[12px] p-3 sm:grid-cols-[1fr_1fr_auto]">
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
            className="border-border bg-surface rounded-[10px] border px-2 text-sm"
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
  };
}) {
  const [v, setV] = useState(initial);
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
