"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgePercent,
  Gift,
  Loader2,
  Pencil,
  Plus,
  Power,
  Tag,
  Ticket,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  PROMOTION_STATUS_META,
  PROMOTION_TYPE_META,
  type PromotionStatus,
  type PromotionType,
} from "@/lib/types";
import {
  deletePromotion,
  togglePromotion,
} from "@/app/(merchant)/promotions/actions";
import type { PromotionListItem } from "@/app/(merchant)/promotions/page";

const TYPE_ICON: Record<PromotionType, typeof Tag> = {
  product_discount: BadgePercent,
  promo_code: Ticket,
  quantity_offer: Gift,
};

const TABS: { key: PromotionStatus; label: string }[] = [
  { key: "active", label: "Actives" },
  { key: "scheduled", label: "Programmées" },
  { key: "expired", label: "Expirées" },
  { key: "disabled", label: "Désactivées" },
];

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function promoValueLabel(p: PromotionListItem): string {
  if (p.type === "quantity_offer") {
    return `${p.buy_qty} acheté${(p.buy_qty ?? 0) > 1 ? "s" : ""} = ${p.get_qty} offert${(p.get_qty ?? 0) > 1 ? "s" : ""}`;
  }
  if (p.discount_kind === "percent") return `−${p.discount_value} %`;
  if (p.discount_kind === "amount")
    return `−${formatDA(p.discount_value ?? 0)}`;
  return "—";
}

function periodLabel(p: PromotionListItem): string {
  const start = formatDate(p.starts_at);
  const end = formatDate(p.ends_at);
  if (start && end) return `${start} → ${end}`;
  if (start) return `À partir du ${start}`;
  if (end) return `Jusqu'au ${end}`;
  return "Permanente";
}

export function PromotionsView({ items }: { items: PromotionListItem[] }) {
  const [tab, setTab] = useState<PromotionStatus>("active");

  const counts = useMemo(() => {
    const c: Record<PromotionStatus, number> = {
      active: 0,
      scheduled: 0,
      expired: 0,
      disabled: 0,
    };
    for (const it of items) c[it.effectiveStatus]++;
    return c;
  }, [items]);

  const filtered = items.filter((it) => it.effectiveStatus === tab);

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Promotions
          </h1>
          <p className="text-muted mt-1 text-sm">
            Créez des réductions, codes promo et offres pour booster vos ventes.
          </p>
        </div>
        <Link href="/promotions/new" className={buttonVariants()}>
          <Plus className="size-4" />
          Créer une promotion
        </Link>
      </header>

      {/* Onglets par statut */}
      <nav className="border-border mb-5 flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "border-primary-600 text-primary-700"
                  : "text-muted hover:text-foreground border-transparent"
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  active
                    ? "bg-primary-100 text-primary-800"
                    : "bg-surface-3 text-muted"
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </nav>

      {filtered.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((p) => (
            <PromotionCard key={p.id} promo={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PromotionCard({ promo }: { promo: PromotionListItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Icon = TYPE_ICON[promo.type];
  const statusMeta = PROMOTION_STATUS_META[promo.effectiveStatus];
  const isDisabled = promo.status === "disabled";

  function onToggle() {
    startTransition(async () => {
      const res = await togglePromotion(promo.id, promo.status);
      if (res.error) return toast.error(res.error);
      toast.success(
        isDisabled ? "Promotion réactivée" : "Promotion désactivée"
      );
      router.refresh();
    });
  }

  function onDelete() {
    if (!window.confirm(`Supprimer la promotion « ${promo.title_fr} » ?`))
      return;
    startTransition(async () => {
      const res = await deletePromotion(promo.id);
      if (res.error) return toast.error(res.error);
      toast.success("Promotion supprimée");
      router.refresh();
    });
  }

  return (
    <li className="border-border bg-surface flex flex-col gap-3 rounded-[16px] border p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="bg-primary-50 text-primary-700 flex size-10 shrink-0 items-center justify-center rounded-[12px]">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{promo.title_fr}</h3>
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          </div>
          <p className="text-muted mt-0.5 text-xs">
            {PROMOTION_TYPE_META[promo.type].label}
            {promo.code && (
              <>
                {" · "}
                <span className="text-foreground font-mono font-semibold">
                  {promo.code}
                </span>
              </>
            )}
          </p>
        </div>
        <span className="text-primary-700 shrink-0 text-base font-bold tabular-nums">
          {promoValueLabel(promo)}
        </span>
      </div>

      <dl className="text-muted grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-subtle">Période</dt>
          <dd className="text-foreground mt-0.5 font-medium">
            {periodLabel(promo)}
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Utilisations</dt>
          <dd className="text-foreground mt-0.5 font-medium tabular-nums">
            {promo.uses_count}
            {promo.max_uses != null && ` / ${promo.max_uses}`}
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Produits</dt>
          <dd className="text-foreground mt-0.5 font-medium tabular-nums">
            {promo.type === "promo_code"
              ? "Total commande"
              : promo.productCount}
          </dd>
        </div>
      </dl>

      <div className="border-border flex items-center gap-1 border-t pt-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={pending || promo.effectiveStatus === "expired"}
          className="text-muted hover:bg-surface-2 hover:text-foreground inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Power className="size-3.5" />
          )}
          {isDisabled ? "Réactiver" : "Désactiver"}
        </button>
        <Link
          href={`/promotions/${promo.id}`}
          className="text-muted hover:bg-surface-2 hover:text-foreground inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium"
        >
          <Pencil className="size-3.5" />
          Modifier
        </Link>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="text-danger-600 hover:bg-danger-50 ml-auto inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          Supprimer
        </button>
      </div>
    </li>
  );
}

function EmptyState({ tab }: { tab: PromotionStatus }) {
  const label = TABS.find((t) => t.key === tab)?.label.toLowerCase() ?? "";
  return (
    <div className="border-border bg-surface flex flex-col items-center justify-center rounded-[16px] border border-dashed py-16 text-center">
      <div className="bg-primary-50 text-primary-600 mb-4 flex size-14 items-center justify-center rounded-2xl">
        <Tag className="size-7" />
      </div>
      <h2 className="text-lg font-semibold">Aucune promotion {label}</h2>
      <p className="text-muted mt-1 max-w-sm text-sm">
        {tab === "active"
          ? "Créez votre première promotion pour attirer plus de clients."
          : "Rien à afficher dans cette catégorie pour le moment."}
      </p>
      {tab === "active" && (
        <Link href="/promotions/new" className={cn(buttonVariants(), "mt-5")}>
          <Plus className="size-4" />
          Créer une promotion
        </Link>
      )}
    </div>
  );
}
