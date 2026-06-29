"use client";

import { useActionState, useEffect, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  Loader2,
  Mail,
  PackagePlus,
  Phone,
  Snowflake,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Pager,
  SearchInput,
  usePaginatedList,
} from "@/components/admin/shared/list-controls";
import { cn, formatDA } from "@/lib/utils";
import type { PlatformSettings } from "@/lib/types";
import { rateToPct } from "@/lib/validation/platform";
import type { AdminMerchant } from "@/lib/data/platform";
import {
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
  // Comptes = commerçants approuvés (les inscriptions en attente / refusées sont
  // gérées dans l'onglet dédié « Inscriptions », mig 0273).
  const pendingCount = useMemo(
    () => merchants.filter((m) => m.approval_status === "pending").length,
    [merchants]
  );
  const approved = useMemo(
    () => merchants.filter((m) => m.approval_status === "approved"),
    [merchants]
  );

  const {
    query,
    setQuery,
    page,
    setPage,
    pageItems,
    filteredCount,
    pageCount,
  } = usePaginatedList<AdminMerchant>({
    items: approved,
    search: (m, q) =>
      [m.name, m.email, m.phone, m.id, m.slug, m.city]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    pageSize: 20,
  });

  return (
    <div className="space-y-6">
      {/* Rappel discret : des inscriptions attendent une validation. */}
      {pendingCount > 0 && (
        <Link
          href="/admin/merchants/inscriptions"
          className="border-warning-200 bg-warning-50/60 text-warning-900 hover:bg-warning-100 flex items-center gap-2 rounded-[12px] border px-4 py-3 text-sm font-medium transition-colors"
        >
          <Clock className="size-4" />
          {pendingCount} inscription{pendingCount > 1 ? "s" : ""} en attente de
          validation — ouvrir l&apos;onglet Inscriptions →
        </Link>
      )}

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Rechercher : nom, e-mail, téléphone, identifiant…"
      />
      <p className="text-muted text-xs tabular-nums">
        {filteredCount} commerçant{filteredCount > 1 ? "s" : ""}
        {query ? ` sur ${approved.length}` : ""}
      </p>

      {pageItems.length === 0 ? (
        <p className="text-muted py-8 text-center text-sm">
          {query
            ? `Aucun commerçant ne correspond à « ${query} ».`
            : "Aucun commerçant validé pour le moment."}
        </p>
      ) : (
        <ul className="space-y-4">
          {pageItems.map((m) => (
            <MerchantRow key={m.id} merchant={m} settings={settings} />
          ))}
        </ul>
      )}

      <Pager page={page} pageCount={pageCount} onPage={setPage} />
    </div>
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
