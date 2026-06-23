"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  ImagePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import {
  createBanner,
  updateBanner,
  toggleBanner,
  deleteBanner,
  uploadBannerImage,
  type BannerInput,
  type BannerActionState,
} from "@/app/admin/bannieres/actions";

// =============================================================================
// Gestion des bannières éditoriales (CRUD super-admin). Aperçu LIVE qui reprend
// exactement le rendu du carrousel client (mêmes classes d'accent). Messages
// inline, jamais de throw : les actions renvoient { ok } | { error }.
// =============================================================================

export type AdminBanner = {
  id: string;
  title: string;
  subtitle: string | null;
  cta_label: string | null;
  image_url: string | null;
  image_fit: "cover" | "contain" | "overlay";
  link: string | null;
  accent: "violet" | "coral" | "mint" | "amber" | "dark";
  position: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

type ImageFit = AdminBanner["image_fit"];
const FIT_OPTIONS: { value: ImageFit; label: string; hint: string }[] = [
  {
    value: "cover",
    label: "Pleine (remplit)",
    hint: "L'image couvre toute la bannière (recadrée si besoin) — « en full ».",
  },
  {
    value: "contain",
    label: "Entière (visible)",
    hint: "L'image entière reste visible, centrée sur le fond de couleur.",
  },
  {
    value: "overlay",
    label: "Texture de fond",
    hint: "Image en fond discret (atténuée) sous le texte.",
  },
];

const ACCENTS = ["violet", "coral", "mint", "amber", "dark"] as const;

const ACCENT_CLASSES: Record<AdminBanner["accent"], string> = {
  violet: "from-primary-700 via-primary-600 to-primary-500 text-white",
  coral: "from-coral-700 via-coral-600 to-coral-500 text-white",
  mint: "from-mint-700 via-mint-600 to-mint-500 text-white",
  amber: "from-amber-600 via-amber-500 to-amber-400 text-foreground",
  dark: "from-foreground via-foreground/95 to-foreground/85 text-white",
};

const ACCENT_LABELS: Record<AdminBanner["accent"], string> = {
  violet: "Violet",
  coral: "Corail",
  mint: "Menthe",
  amber: "Ambre",
  dark: "Sombre",
};

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function emptyDraft(): Draft {
  return {
    title: "",
    subtitle: "",
    cta_label: "",
    image_url: "",
    image_fit: "cover",
    link: "",
    accent: "violet",
    position: 0,
    active: true,
    starts_at: "",
    ends_at: "",
  };
}

// Brouillon = état du formulaire (dates en valeur datetime-local).
type Draft = {
  title: string;
  subtitle: string;
  cta_label: string;
  image_url: string;
  image_fit: ImageFit;
  link: string;
  accent: AdminBanner["accent"];
  position: number;
  active: boolean;
  starts_at: string;
  ends_at: string;
};

function bannerToDraft(b: AdminBanner): Draft {
  return {
    title: b.title,
    subtitle: b.subtitle ?? "",
    cta_label: b.cta_label ?? "",
    image_url: b.image_url ?? "",
    image_fit: b.image_fit ?? "overlay",
    link: b.link ?? "",
    accent: b.accent,
    position: b.position,
    active: b.active,
    starts_at: isoToLocalInput(b.starts_at),
    ends_at: isoToLocalInput(b.ends_at),
  };
}

function draftToInput(d: Draft): BannerInput {
  return {
    title: d.title,
    subtitle: d.subtitle,
    cta_label: d.cta_label,
    image_url: d.image_url,
    image_fit: d.image_fit,
    link: d.link,
    accent: d.accent,
    position: Number(d.position) || 0,
    active: d.active,
    starts_at: localInputToIso(d.starts_at),
    ends_at: localInputToIso(d.ends_at),
  };
}

/**
 * Redimensionne/compresse une image côté client AVANT l'upload : borne la plus
 * grande dimension à 1600 px et ré-encode en JPEG qualité 0.85. Garantit qu'une
 * image énorme « s'intègre » sans alourdir le stockage ni casser l'affichage.
 */
async function resizeImage(file: File): Promise<Blob> {
  const MAX = 1600;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", 0.85)
  );
  return blob ?? file;
}

const INPUT =
  "h-10 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm focus:border-primary-400 focus:ring-2 focus:ring-primary-400 focus:outline-none";
const LABEL = "text-foreground mb-1 block text-[12px] font-bold";

function PreviewCard({ d }: { d: Draft }) {
  const hasImg = !!d.image_url;
  const scrim = hasImg && d.image_fit !== "overlay";
  return (
    <article
      className={cn(
        "relative flex flex-col justify-between overflow-hidden rounded-[20px] bg-gradient-to-br px-5 py-5 shadow-md",
        ACCENT_CLASSES[d.accent]
      )}
      style={{ minHeight: 140 }}
    >
      {hasImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={d.image_url}
          alt=""
          className={cn(
            "absolute inset-0 h-full w-full",
            d.image_fit === "cover"
              ? "object-cover"
              : d.image_fit === "contain"
                ? "object-contain"
                : "object-cover opacity-30 mix-blend-overlay"
          )}
        />
      )}
      {scrim && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
      )}
      <div className="relative">
        <h3 className="font-display text-lg leading-tight font-bold">
          {d.title || "Titre de la bannière"}
        </h3>
        {d.subtitle && <p className="mt-1 text-sm opacity-90">{d.subtitle}</p>}
      </div>
      {d.cta_label && (
        <div className="relative mt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur">
            {d.cta_label}
            <ArrowRight className="size-3.5" />
          </span>
        </div>
      )}
    </article>
  );
}

function BannerForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  pending: boolean;
  onSubmit: (input: BannerInput) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploadErr(null);
    setUploading(true);
    try {
      const blob = await resizeImage(file);
      const fd = new FormData();
      fd.append("file", blob, "banner.jpg");
      const res = await uploadBannerImage(fd);
      if (res.error) setUploadErr(res.error);
      else if (res.url) {
        set("image_url", res.url);
        // À la 1re image, on bascule sur « pleine » si on était en texture.
        if (d.image_fit === "overlay") set("image_fit", "cover");
      }
    } catch {
      setUploadErr("Upload impossible. Réessayez.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border-border-strong space-y-4 rounded-[14px] border bg-white p-4">
      {/* Aperçu live */}
      <div>
        <span className={LABEL}>Aperçu</span>
        <PreviewCard d={d} />
      </div>

      <div>
        <label className={LABEL}>Titre *</label>
        <input
          className={INPUT}
          value={d.title}
          maxLength={100}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Ex. Livraison offerte ce week-end"
        />
      </div>

      <div>
        <label className={LABEL}>Sous-titre</label>
        <input
          className={INPUT}
          value={d.subtitle}
          maxLength={200}
          onChange={(e) => set("subtitle", e.target.value)}
          placeholder="Ex. Sur toutes vos commandes en livraison"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Libellé du bouton</label>
          <input
            className={INPUT}
            value={d.cta_label}
            maxLength={50}
            onChange={(e) => set("cta_label", e.target.value)}
            placeholder="Ex. J'en profite"
          />
        </div>
        <div>
          <label className={LABEL}>Couleur</label>
          <select
            className={INPUT}
            value={d.accent}
            onChange={(e) =>
              set("accent", e.target.value as AdminBanner["accent"])
            }
          >
            {ACCENTS.map((a) => (
              <option key={a} value={a}>
                {ACCENT_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={LABEL}>Lien (au clic) — interne ou URL</label>
        <input
          className={INPUT}
          value={d.link}
          maxLength={500}
          onChange={(e) => set("link", e.target.value)}
          placeholder="Ex. /favoris  ou  https://…"
        />
      </div>

      {/* Image : upload (recommandé) + mode d'intégration */}
      <div className="border-border-strong space-y-3 rounded-[12px] border border-dashed p-3">
        <div>
          <label className={LABEL}>Image de la bannière (optionnel)</label>
          <p className="text-muted mb-2 text-[11px] leading-snug">
            Format conseillé : ~1200×600 px (paysage). Toute image, même grande,
            est automatiquement redimensionnée et intégrée au cadre — aucune
            déformation. PNG, JPG ou WEBP, 5 Mo max.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="border-primary-200 text-primary-700 hover:bg-primary-50 inline-flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border-[1.5px] px-3 text-sm font-bold">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              {d.image_url ? "Changer l'image" : "Téléverser une image"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  void onPickImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {d.image_url && (
              <button
                type="button"
                onClick={() => set("image_url", "")}
                className="text-danger-600 hover:bg-danger-50 inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold"
              >
                <Trash2 className="size-4" /> Retirer
              </button>
            )}
          </div>
          {uploadErr && (
            <p className="text-danger-700 mt-1.5 text-[12px] font-semibold">
              {uploadErr}
            </p>
          )}
          <input
            className={cn(INPUT, "mt-2")}
            value={d.image_url}
            maxLength={500}
            onChange={(e) => set("image_url", e.target.value)}
            placeholder="… ou collez une URL d'image"
          />
        </div>

        {d.image_url && (
          <div>
            <label className={LABEL}>Affichage de l&apos;image</label>
            <div className="grid grid-cols-3 gap-2">
              {FIT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => set("image_fit", o.value)}
                  className={cn(
                    "rounded-[10px] border px-2 py-2 text-[12px] font-bold transition-colors",
                    d.image_fit === o.value
                      ? "border-primary-600 bg-primary-50 text-primary-700"
                      : "border-border-strong text-muted hover:bg-surface-2"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-muted mt-1 text-[11px]">
              {FIT_OPTIONS.find((o) => o.value === d.image_fit)?.hint}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Début (optionnel)</label>
          <input
            type="datetime-local"
            className={INPUT}
            value={d.starts_at}
            onChange={(e) => set("starts_at", e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL}>Fin (optionnel)</label>
          <input
            type="datetime-local"
            className={INPUT}
            value={d.ends_at}
            onChange={(e) => set("ends_at", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Ordre d&apos;affichage</label>
          <input
            type="number"
            min={0}
            max={9999}
            className={INPUT}
            value={d.position}
            onChange={(e) => set("position", Number(e.target.value))}
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={d.active}
            onChange={(e) => set("active", e.target.checked)}
            className="size-4"
          />
          Active (visible)
        </label>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => onSubmit(draftToInput(d))}
          className="bg-primary-600 hover:bg-primary-700 inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-4 text-sm font-bold text-white transition-colors disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Enregistrer
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-border-strong text-muted hover:bg-surface-2 inline-flex h-10 items-center justify-center rounded-[10px] border px-4 text-sm font-semibold"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

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
                  {b.title}
                  {!b.active && (
                    <span className="text-muted ml-2 text-[11px] font-semibold">
                      · inactive
                    </span>
                  )}
                </p>
                <p className="text-muted truncate text-[12px]">
                  {b.subtitle || ACCENT_LABELS[b.accent]}
                  {b.link ? ` · ${b.link}` : ""}
                </p>
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
