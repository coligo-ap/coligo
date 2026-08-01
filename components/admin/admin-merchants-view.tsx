"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  Loader2,
  Mail,
  PackagePlus,
  Phone,
  SlidersHorizontal,
  Snowflake,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import {
  Pager,
  SearchInput,
  usePaginatedList,
} from "@/components/admin/shared/list-controls";
import { cn, formatDA } from "@/lib/utils";
import { useAdminList } from "@/lib/admin/use-admin-list";
import type { PlatformSettings } from "@/lib/types";
import { rateToPct } from "@/lib/validation/platform";
import type {
  AdminMerchant,
  MerchantCategoryOption,
} from "@/lib/data/platform";
import { MerchantManageSheet } from "@/components/admin/merchant-manage-sheet";
import { MerchantCategoriesPanel } from "@/components/admin/merchants/merchant-categories-panel";
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

const PAGE = 3; // on n'en affiche que 3 : la suite se charge à la demande

export function AdminMerchantsView({
  initialMerchants,
  initialTotal,
  settings,
  categoryOptions,
}: {
  initialMerchants: AdminMerchant[];
  initialTotal: number;
  settings: PlatformSettings | null;
  categoryOptions: MerchantCategoryOption[];
}) {
  // Liste PAGINÉE côté serveur (mig 0429). On ne charge plus tout l'annuaire
  // pour le filtrer ensuite dans le navigateur : chaque ligne coûte une somme
  // sur le portefeuille, et l'écran n'en montre que trois.
  const [rows, setRows] = useState<AdminMerchant[]>(initialMerchants);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState<AdminMerchant | null>(null);

  const load = useCallback(async (q: string, offset: number) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/merchants?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        rows: AdminMerchant[];
        total: number;
      };
      setTotal(data.total);
      setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
    } finally {
      setBusy(false);
    }
  }, []);

  // Recherche EN BASE, temporisée : on ne part pas à chaque frappe.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => void load(query, 0), 350);
    return () => clearTimeout(id);
  }, [query, load]);

  const pendingCount = useMemo(
    () => rows.filter((m) => m.approval_status === "pending").length,
    [rows]
  );
  const pageItems = useMemo(
    () => rows.filter((m) => m.approval_status === "approved"),
    [rows]
  );
  const filteredCount = total;

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
        {pageItems.length} affiché{pageItems.length > 1 ? "s" : ""} sur{" "}
        {filteredCount} commerçant{filteredCount > 1 ? "s" : ""}
        {query ? " (recherche)" : ""}
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
            <div key={m.id} className="relative">
              <MerchantRow
                merchant={m}
                settings={settings}
                categoryOptions={categoryOptions}
              />
              {/* Fiche complète : dépanner un commerçant qui n'y arrive pas
                  seul (visuels, adresse, livraison, état). Les taux gardent
                  leur propre réglage, juste au-dessus. */}
              <button
                type="button"
                onClick={() => setManaging(m)}
                className="border-border text-foreground hover:bg-surface-2 mt-2 flex w-full items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-bold transition-colors"
              >
                <SlidersHorizontal className="size-3.5" />
                Gérer la fiche
              </button>
            </div>
          ))}
        </ul>
      )}

      {managing && (
        <MerchantManageSheet
          merchant={managing}
          onClose={() => setManaging(null)}
          onSaved={() => void load(query, 0)}
        />
      )}

      {/* « Voir plus » plutôt qu'une pagination : on ajoute une poignée de
          lignes à la demande, sans jamais tout charger d'un coup. */}
      {rows.length < total && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(query, rows.length)}
          className="border-border text-foreground hover:bg-surface-2 w-full rounded-[12px] border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {busy
            ? "Chargement…"
            : `Voir plus (${total - rows.length} restant${total - rows.length > 1 ? "s" : ""})`}
        </button>
      )}
    </div>
  );
}

function MerchantRow({
  merchant,
  settings,
  categoryOptions,
}: {
  merchant: AdminMerchant;
  settings: PlatformSettings | null;
  categoryOptions: MerchantCategoryOption[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const action = updateMerchantRates.bind(null, merchant.id);
  const [state, formAction, saving] = useActionState(action, initialState);
  const fb = useFormActionFeedback({
    pending: saving,
    ok: state.ok,
    error: state.error,
  });
  const [note, setNote] = useActionNote();

  useEffect(() => {
    // Succès porté par le bouton (ActionButton) — pas de toast.
    if (state.ok) router.refresh();
  }, [state, router]);

  const debt = merchant.balance < 0 ? -merchant.balance : 0;

  function onToggleFreeze() {
    startTransition(async () => {
      const res = await toggleMerchantFrozen(merchant.id, !merchant.is_frozen);
      // Succès : le badge « Gelé » apparaît/disparaît après refresh (visuel).
      if (res.error) return setNote({ ok: false, text: res.error });
      router.refresh();
    });
  }

  const [seeding, startSeed] = useTransition();
  const template = getCatalogTemplate(merchant.category);

  async function onSeedCatalog() {
    if (
      !(await confirm({
        title: `Remplir le catalogue de « ${merchant.name} » ?`,
        message: `Modèle ${template?.label}. Les produits/catégories déjà présents ne seront pas dupliqués. Le commerçant pourra tout ajuster (prix, photos, détails).`,
        confirmLabel: "Remplir",
      }))
    )
      return;
    startSeed(async () => {
      const res = await seedMerchantCatalog(merchant.id);
      if (!res.ok) return setNote({ ok: false, text: res.error });
      // Résultat chiffré non visible ailleurs → note inline informative.
      setNote({
        ok: true,
        text: `Catalogue rempli (${res.label}) : +${res.categoriesAdded} catégories, +${res.productsAdded} produits`,
      });
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
          <ActionButton
            type="submit"
            size="sm"
            state={fb}
            labels={{
              idle: "Enregistrer les taux",
              success: "Taux mis à jour ✓",
            }}
          />
          <span className="text-subtle text-xs">
            Vide = hérite du taux global.
          </span>
        </div>
      </form>

      {/* Raccordement aux catégories (principale + secondaires, mig 0312). */}
      <MerchantCategoriesPanel
        merchantId={merchant.id}
        primaryCategory={merchant.category}
        options={categoryOptions}
      />

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

      <ActionNote note={note} className="mt-3" />
    </li>
  );
}
