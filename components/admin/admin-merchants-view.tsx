"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  MapPin,
  PackagePlus,
  Phone,
  Search,
  Snowflake,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import { cn, formatDA } from "@/lib/utils";
import type { PlatformSettings } from "@/lib/types";
import { rateToPct } from "@/lib/validation/platform";
import type { AdminMerchant } from "@/lib/data/platform";
import {
  decideMerchantApproval,
  seedMerchantCatalog,
  toggleMerchantFrozen,
  updateMerchantRates,
  type AdminFormState,
} from "@/app/admin/actions";
import { getCatalogTemplate } from "@/lib/config/catalog-templates";

const initialState: AdminFormState = {};

const OVERRIDE_FIELDS: {
  name:
    | "commission_cash"
    | "commission_online"
    | "cashback_online"
    | "cashback_cash";
  label: string;
  settingsKey: keyof PlatformSettings;
}[] = [
  {
    name: "commission_cash",
    label: "Comm. cash",
    settingsKey: "commission_cash",
  },
  {
    name: "commission_online",
    label: "Comm. online",
    settingsKey: "commission_online",
  },
  {
    name: "cashback_online",
    label: "Cashback online",
    settingsKey: "cashback_online",
  },
  {
    name: "cashback_cash",
    label: "Cashback cash",
    settingsKey: "cashback_cash",
  },
];

export function AdminMerchantsView({
  merchants,
  settings,
}: {
  merchants: AdminMerchant[];
  settings: PlatformSettings | null;
}) {
  const [query, setQuery] = useState("");

  // Demandes d'inscription à traiter (mig 0273) — toujours en tête, hors recherche.
  const pending = useMemo(
    () => merchants.filter((m) => m.approval_status === "pending"),
    [merchants]
  );
  const others = useMemo(
    () => merchants.filter((m) => m.approval_status !== "pending"),
    [merchants]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return others;
    return others.filter((m) =>
      [m.name, m.email, m.phone, m.id, m.slug, m.city]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [others, query]);

  if (merchants.length === 0) {
    return <p className="text-muted text-sm">Aucun commerçant.</p>;
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 && <PendingQueue merchants={pending} />}

      {/* Recherche : nom, e-mail, téléphone, identifiant (id) ou slug. */}
      <div className="relative">
        <Search className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
        <Input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher : nom, e-mail, téléphone, identifiant…"
          className="h-12 pl-10"
        />
      </div>
      <p className="text-muted text-xs tabular-nums">
        {filtered.length} commerçant{filtered.length > 1 ? "s" : ""}
        {query ? ` sur ${others.length}` : ""}
      </p>

      {filtered.length === 0 ? (
        <p className="text-muted py-8 text-center text-sm">
          {query
            ? `Aucun commerçant ne correspond à « ${query} ».`
            : "Aucun commerçant validé pour le moment."}
        </p>
      ) : (
        <ul className="space-y-4">
          {filtered.map((m) => (
            <MerchantRow key={m.id} merchant={m} settings={settings} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────── DEMANDES D'INSCRIPTION À TRAITER (mig 0273) ───────────────── */

function formatSubmitted(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

function PendingQueue({ merchants }: { merchants: AdminMerchant[] }) {
  return (
    <section className="border-warning-200 bg-warning-50/60 rounded-[16px] border p-4 lg:p-5">
      <h2 className="text-warning-900 mb-1 flex items-center gap-2 text-base font-bold">
        <Clock className="size-4" />
        Demandes à traiter ({merchants.length})
      </h2>
      <p className="text-muted mb-4 text-sm">
        Nouvelles inscriptions en attente. Le commerce reste{" "}
        <strong>
          invisible des clients et ne peut pas recevoir de commande
        </strong>{" "}
        tant qu&apos;il n&apos;est pas approuvé.
      </p>
      <ul className="space-y-2">
        {merchants.map((m) => (
          <PendingMerchantCard key={m.id} merchant={m} />
        ))}
      </ul>
    </section>
  );
}

function PendingMerchantCard({ merchant }: { merchant: AdminMerchant }) {
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [pending, startTransition] = useTransition();

  const run = (decision: "approve" | "reject", reason?: string) =>
    startTransition(async () => {
      const res = await decideMerchantApproval(merchant.id, decision, reason);
      if (res.error) return toast.error(res.error);
      toast.success(
        decision === "approve"
          ? `« ${merchant.name} » approuvé — la boutique est en ligne`
          : `« ${merchant.name} » refusé`
      );
      router.refresh();
    });

  const askApprove = async () => {
    const ok = await confirm({
      title: "Approuver ce commerçant ?",
      message: `« ${merchant.name} » deviendra visible des clients et pourra recevoir des commandes.`,
      confirmLabel: "Approuver",
    });
    if (ok) run("approve");
  };

  const askReject = async () => {
    const reason = await prompt({
      title: "Refuser cette demande ?",
      message: `Motif communiqué à « ${merchant.name} » (facultatif).`,
      placeholder: "Ex. dossier incomplet, hors zone…",
      confirmLabel: "Refuser",
    });
    // prompt renvoie null si annulé ; "" si validé sans texte.
    if (reason !== null) run("reject", reason);
  };

  const loc = [merchant.city].filter(Boolean).join(", ");

  return (
    <li className="border-warning-200 bg-surface rounded-[14px] border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{merchant.name}</h3>
            {merchant.category && (
              <Badge tone="neutral">{merchant.category}</Badge>
            )}
          </div>
          <div className="text-muted mt-1 space-y-0.5 text-xs">
            {loc && (
              <p className="flex items-center gap-1.5">
                <MapPin className="size-3" />
                {loc}
              </p>
            )}
            {merchant.email && (
              <p className="flex items-center gap-1.5">
                <Mail className="size-3" />
                <span className="truncate">{merchant.email}</span>
              </p>
            )}
            {merchant.phone && (
              <p className="flex items-center gap-1.5">
                <Phone className="size-3" />
                {merchant.phone}
              </p>
            )}
            <p className="text-subtle">
              Demande du {formatSubmitted(merchant.submitted_at)}
            </p>
          </div>
        </div>

        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={askReject}
            className="text-danger-600 hover:bg-danger-50"
          >
            <XCircle className="size-4" />
            Refuser
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={askApprove}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Approuver
          </Button>
        </div>
      </div>
    </li>
  );
}

function MerchantRow({
  merchant,
  settings,
}: {
  merchant: AdminMerchant;
  settings: PlatformSettings | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const action = updateMerchantRates.bind(null, merchant.id);
  const [state, formAction, saving] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) {
      toast.success("Taux du commerçant mis à jour");
      router.refresh();
    }
  }, [state, router]);

  const debt = merchant.balance < 0 ? -merchant.balance : 0;

  function onToggleFreeze() {
    startTransition(async () => {
      const res = await toggleMerchantFrozen(merchant.id, !merchant.is_frozen);
      if (res.error) return toast.error(res.error);
      toast.success(
        merchant.is_frozen ? "Commerçant dégelé" : "Commerçant gelé"
      );
      router.refresh();
    });
  }

  const [seeding, startSeed] = useTransition();
  const template = getCatalogTemplate(merchant.category);

  function onSeedCatalog() {
    if (
      !confirm(
        `Remplir automatiquement le catalogue de « ${merchant.name} » avec le modèle ${template?.label} ?\n\nLes produits/catégories déjà présents ne seront pas dupliqués. Le commerçant pourra tout ajuster (prix, photos, détails).`
      )
    )
      return;
    startSeed(async () => {
      const res = await seedMerchantCatalog(merchant.id);
      if (!res.ok) return toast.error(res.error);
      toast.success(
        `Catalogue rempli (${res.label}) : +${res.categoriesAdded} catégories, +${res.productsAdded} produits`
      );
      router.refresh();
    });
  }

  return (
    <li className="border-border bg-surface rounded-[16px] border p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{merchant.name}</h3>
            {merchant.is_frozen && <Badge tone="danger">Gelé</Badge>}
            {!merchant.is_active && <Badge tone="neutral">Inactif</Badge>}
          </div>
          {/* Infos existantes — l'admin voit d'emblée ce qui existe. */}
          <div className="text-muted mt-1 space-y-0.5 text-xs">
            <p>{merchant.city ?? "—"}</p>
            {merchant.email && (
              <p className="flex items-center gap-1.5">
                <Mail className="size-3" />
                <span className="truncate">{merchant.email}</span>
              </p>
            )}
            {merchant.phone && (
              <p className="flex items-center gap-1.5">
                <Phone className="size-3" />
                {merchant.phone}
              </p>
            )}
            <p className="text-subtle font-mono text-[10px]">
              id&nbsp;{merchant.id}
              {merchant.slug ? ` · ${merchant.slug}` : ""}
            </p>
          </div>
        </div>
        <div className="text-right">
          {debt > 0 ? (
            <p className="text-danger-600 text-sm font-semibold tabular-nums">
              Dette : {formatDA(debt)}
            </p>
          ) : (
            <p className="text-success-700 text-sm font-semibold tabular-nums">
              Solde : {formatDA(merchant.balance)}
            </p>
          )}
          <button
            type="button"
            onClick={onToggleFreeze}
            disabled={pending}
            className={cn(
              "mt-1 inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-xs font-medium",
              merchant.is_frozen
                ? "text-success-700 hover:bg-success-50"
                : "text-danger-600 hover:bg-danger-50"
            )}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Snowflake className="size-3.5" />
            )}
            {merchant.is_frozen ? "Dégeler" : "Geler"}
          </button>
        </div>
      </div>

      <form action={formAction} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {OVERRIDE_FIELDS.map((f) => (
            <div key={f.name} className="space-y-1">
              <label className="text-muted text-[11px] font-medium">
                {f.label} (%)
              </label>
              <Input
                type="number"
                name={f.name}
                defaultValue={rateToPct(merchant[f.name])}
                placeholder={
                  settings ? rateToPct(settings[f.settingsKey] as number) : ""
                }
                min={0}
                max={100}
                step="0.01"
                disabled={saving}
                className="h-10"
              />
            </div>
          ))}
        </div>
        {state.error && (
          <p className="text-danger-600 text-xs">{state.error}</p>
        )}
        {(() => {
          // Garde-fou Chargily : on ABSORBE toujours les frais de paiement
          // (jamais facturés au commerçant). Mais si la commission online passe
          // SOUS le taux Chargily, chaque commande en ligne fait PERDRE de
          // l'argent à Coligo (frais absorbés non couverts par la commission).
          const chargily = settings?.chargily_fee ?? 0;
          const effOnline =
            merchant.commission_online ?? settings?.commission_online ?? 0;
          if (chargily <= 0 || effOnline >= chargily) return null;
          return (
            <p className="text-danger-700 bg-danger-50 border-danger-200 flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Commission online ({rateToPct(effOnline)} %) sous le seuil
                Chargily ({rateToPct(chargily)} %) : Coligo{" "}
                <strong>perd</strong> sur chaque commande en ligne (frais de
                paiement absorbés non couverts). Remonte la commission ou
                désactive l&apos;online.
              </span>
            </p>
          );
        })()}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Enregistrer les taux
          </Button>
          <span className="text-subtle text-xs">
            Vide = hérite du taux global.
          </span>
        </div>
      </form>

      {/* Remplissage automatique du catalogue selon le type de commerce. */}
      <div className="border-border mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
        {template ? (
          <>
            <button
              type="button"
              onClick={onSeedCatalog}
              disabled={seeding}
              className="bg-primary-50 text-primary-700 hover:bg-primary-100 inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {seeding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PackagePlus className="size-4" />
              )}
              Remplir le catalogue ({template.label})
            </button>
            <span className="text-subtle text-xs">
              Idempotent · le commerçant ajuste ensuite prix / photos / détails.
            </span>
          </>
        ) : (
          <span className="text-subtle text-xs">
            Aucun modèle de catalogue pour ce type de commerce
            {merchant.category ? ` (« ${merchant.category} »)` : ""}.
          </span>
        )}
      </div>
    </li>
  );
}
