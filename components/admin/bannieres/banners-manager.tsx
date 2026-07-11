"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Store,
  Ticket,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import {
  createBanner,
  updateBanner,
  toggleBanner,
  deleteBanner,
  type BannerActionState,
} from "@/app/admin/bannieres/actions";
import { BannerForm } from "./banner-form";
import {
  emptyDraft,
  bannerToDraft,
  ACCENT_CLASSES,
  ACCENT_LABELS,
  type AdminBanner,
} from "./banners-shared";

// Chemin d'import stable pour les consommateurs existants (banners-view).
export type { AdminBanner } from "./banners-shared";

// =============================================================================
// Gestion des bannières éditoriales (CRUD super-admin). Aperçu LIVE qui reprend
// exactement le rendu du carrousel client (mêmes classes d'accent). Messages
// inline, jamais de throw : les actions renvoient { ok } | { error }.
// =============================================================================

export function BannersManager({ banners }: { banners: AdminBanner[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null); // id | "new" | null
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(
    action: () => Promise<BannerActionState>,
    opts: { closeForm?: boolean; id?: string } = {}
  ) {
    setError(null);
    setBusyId(opts.id ?? null);
    start(async () => {
      const r = await action();
      setBusyId(null);
      if (r.error) {
        setError(r.error);
        return;
      }
      if (opts.closeForm) setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="border-danger-100 bg-danger-50 text-danger-700 rounded-[10px] border px-3 py-2 text-sm font-semibold">
          {error}
        </p>
      )}

      {editing === "new" ? (
        <BannerForm
          initial={emptyDraft()}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSubmit={(input) =>
            run(() => createBanner(input), { closeForm: true })
          }
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setEditing("new");
          }}
          className="border-primary-200 text-primary-700 hover:bg-primary-50 inline-flex h-11 items-center gap-2 rounded-[12px] border-[1.5px] border-dashed px-4 text-sm font-bold"
        >
          <Plus className="size-4" />
          Nouvelle bannière
        </button>
      )}

      {banners.length === 0 && editing !== "new" && (
        <p className="text-muted py-6 text-center text-sm">
          Aucune bannière. Créez-en une pour la mettre en avant sur
          l&apos;accueil.
        </p>
      )}

      <ul className="space-y-3">
        {banners.map((b) =>
          editing === b.id ? (
            <li key={b.id}>
              <BannerForm
                initial={bannerToDraft(b)}
                pending={pending}
                onCancel={() => setEditing(null)}
                onSubmit={(input) =>
                  run(() => updateBanner(b.id, input), { closeForm: true })
                }
              />
            </li>
          ) : (
            <li
              key={b.id}
              className="border-border-strong flex items-center gap-3 rounded-[14px] border bg-white p-3"
            >
              <span
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br text-xs font-black",
                  ACCENT_CLASSES[b.accent]
                )}
                aria-hidden
              >
                {b.position}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-bold">
                  {b.merchant_id && (
                    <span className="bg-primary-50 text-primary-700 me-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-bold">
                      <Ticket className="size-2.5" /> Offre
                    </span>
                  )}
                  {b.title}
                  {!b.active && (
                    <span className="text-muted ml-2 text-[11px] font-semibold">
                      · inactive
                    </span>
                  )}
                </p>
                {b.merchant_id ? (
                  <p className="text-muted flex items-center gap-1 truncate text-[12px]">
                    <Store className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {b.merchant_name ?? "Commerçant"}
                      {b.offer_summary ? ` · ${b.offer_summary}` : ""}
                    </span>
                    {b.offer_active === false && (
                      <span className="shrink-0 font-semibold text-amber-700">
                        · masquée (offre inactive)
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-muted flex items-center gap-1 truncate text-[12px]">
                    <span className="truncate">
                      {b.subtitle || ACCENT_LABELS[b.accent]}
                      {b.link ? ` · ${b.link}` : ""}
                    </span>
                    {b.zones && b.zones.length > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5">
                        <MapPin className="size-3.5" />
                        {b.zones.length}
                      </span>
                    ) : (
                      <Globe className="size-3.5 shrink-0" />
                    )}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title={b.active ? "Désactiver" : "Activer"}
                  disabled={pending && busyId === b.id}
                  onClick={() =>
                    run(() => toggleBanner(b.id, !b.active), { id: b.id })
                  }
                  className="text-muted hover:bg-surface-2 hover:text-foreground grid size-9 place-items-center rounded-[9px]"
                >
                  {b.active ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                </button>
                <button
                  type="button"
                  title="Modifier"
                  onClick={() => {
                    setError(null);
                    setEditing(b.id);
                  }}
                  className="text-muted hover:bg-surface-2 hover:text-foreground grid size-9 place-items-center rounded-[9px]"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  title="Supprimer"
                  disabled={pending && busyId === b.id}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Supprimer la bannière",
                      message: `Supprimer la bannière « ${b.title} » ? Cette action est définitive.`,
                      confirmLabel: "Supprimer",
                      danger: true,
                    });
                    if (ok) run(() => deleteBanner(b.id), { id: b.id });
                  }}
                  className="text-danger-600 hover:bg-danger-50 grid size-9 place-items-center rounded-[9px]"
                >
                  {pending && busyId === b.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </button>
              </div>
            </li>
          )
        )}
      </ul>
    </div>
  );
}
