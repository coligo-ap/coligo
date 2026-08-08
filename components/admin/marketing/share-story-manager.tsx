"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ExternalLink,
  ImagePlus,
  Loader2,
  Power,
  Trash2,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import {
  setShareStorySettings,
  uploadStoryImage,
} from "@/app/admin/marketing/actions";
import type { ShareStorySettings, StoryDesign } from "@/lib/data/share-story";

// =============================================================================
// ShareStoryManager — Marketing > Story : le PARTAGE STORY post-commande.
// L'équipe active/désactive la carte sur les commandes livrées, choisit le
// DESIGN de la story générée (8 palettes, aperçu = les vrais dégradés du
// canvas) et peut ajouter une PHOTO qui accompagne le texte (dessinée en fond
// sous le voile dégradé — l'aperçu montre le rendu réel). Les CONDITIONS
// (cadeaux parrain/filleul, minimum) se règlent dans Parrainage.
// =============================================================================

const DESIGNS: { key: StoryDesign; label: string; gradient: string }[] = [
  {
    key: "violet",
    label: "Violet marque",
    gradient: "linear-gradient(135deg,#8A4DFF,#6C2BD9,#4B1FA6)",
  },
  {
    key: "rose",
    label: "Rose promo",
    gradient: "linear-gradient(135deg,#FF2D7A,#C2338F,#6C2BD9)",
  },
  {
    key: "nuit",
    label: "Nuit",
    gradient: "linear-gradient(135deg,#191036,#2A1458,#4B1FA6)",
  },
  {
    key: "ambre",
    label: "Ambre festif",
    gradient: "linear-gradient(135deg,#F59E0B,#F97316,#FF2D7A)",
  },
  {
    key: "emeraude",
    label: "Émeraude",
    gradient: "linear-gradient(135deg,#34D399,#0D9488,#064E3B)",
  },
  {
    key: "ocean",
    label: "Océan",
    gradient: "linear-gradient(135deg,#38BDF8,#2563EB,#1E3A8A)",
  },
  {
    key: "corail",
    label: "Corail",
    gradient: "linear-gradient(135deg,#FB7185,#F43F5E,#881337)",
  },
  {
    key: "or",
    label: "Or premium",
    gradient: "linear-gradient(135deg,#FCD34D,#D97706,#78350F)",
  },
];

/** Voile du design par-dessus la photo (rendu identique au canvas : α 0.78). */
function overlayGradient(gradient: string): string {
  // linear-gradient(135deg,#AAA,#BBB,#CCC) → même dégradé en rgba α 0.78.
  const withAlpha = gradient.replace(
    /#([0-9A-Fa-f]{6})/g,
    (_, hex: string) =>
      `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},0.78)`
  );
  return withAlpha;
}

export function ShareStoryManager({
  initial,
  referral,
}: {
  initial: ShareStorySettings;
  referral: {
    enabled: boolean;
    reward_referrer_da: number;
    reward_referee_da: number;
    min_order_da: number;
  } | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [togglePending, startToggle] = useTransition();
  const [designPending, startDesign] = useTransition();
  const [photoPending, startPhoto] = useTransition();
  const [removePending, startRemove] = useTransition();

  const activeGradient =
    DESIGNS.find((d) => d.key === settings.design)?.gradient ??
    DESIGNS[0].gradient;

  function toggle() {
    setError(null);
    startToggle(async () => {
      const next = !settings.enabled;
      const res = await setShareStorySettings({ enabled: next });
      if (res.error) setError(res.error);
      else {
        setSettings((s) => ({ ...s, enabled: next }));
        router.refresh();
      }
    });
  }

  function pickDesign(design: StoryDesign) {
    if (design === settings.design) return;
    setError(null);
    startDesign(async () => {
      const res = await setShareStorySettings({ design });
      if (res.error) setError(res.error);
      else {
        setSettings((s) => ({ ...s, design }));
        router.refresh();
      }
    });
  }

  function onPhotoPicked(file: File | null) {
    if (!file) return;
    setError(null);
    startPhoto(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const up = await uploadStoryImage(fd);
      if (up.error || !up.url) {
        setError(up.error ?? "Upload impossible.");
        return;
      }
      const res = await setShareStorySettings({ imageUrl: up.url });
      if (res.error) setError(res.error);
      else {
        setSettings((s) => ({ ...s, image_url: up.url ?? null }));
        router.refresh();
      }
    });
  }

  function removePhoto() {
    setError(null);
    startRemove(async () => {
      const res = await setShareStorySettings({ imageUrl: null });
      if (res.error) setError(res.error);
      else {
        setSettings((s) => ({ ...s, image_url: null }));
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Activation */}
      <section className="border-border bg-surface rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">
              Carte de partage post-commande
            </h2>
            <p className="text-muted text-body-sm mt-0.5">
              Sur chaque commande livrée : story générée (code parrain + QR),
              partage WhatsApp / Facebook / Instagram / TikTok / Snapchat.
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={togglePending}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60",
              settings.enabled
                ? "bg-success-600 hover:bg-success-700"
                : "bg-danger-600 hover:bg-danger-700"
            )}
          >
            {togglePending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Power className="size-4" />
            )}
            {settings.enabled ? "Activée" : "Désactivée"}
          </button>
        </div>
      </section>

      {/* Design de la story */}
      <section className="border-border bg-surface rounded-lg border p-4">
        <h2 className="text-sm font-bold">Design de la story</h2>
        <p className="text-muted text-body-sm mt-0.5">
          Appliqué immédiatement à l&apos;image générée (1080×1920) ET à la
          carte dans l&apos;app.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DESIGNS.map((d) => {
            const active = settings.design === d.key;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => pickDesign(d.key)}
                disabled={designPending}
                className={cn(
                  "rounded-card-lg border-2 p-1.5 text-left transition-all disabled:opacity-60",
                  active
                    ? "border-primary-600 ring-primary-500/25 ring-2"
                    : "border-border hover:border-primary-300"
                )}
              >
                <span
                  className="rounded-control relative block aspect-9/16 max-h-36 w-full overflow-hidden bg-cover bg-center"
                  style={{
                    backgroundImage: settings.image_url
                      ? `${overlayGradient(d.gradient)}, url(${settings.image_url})`
                      : d.gradient,
                  }}
                >
                  <span className="text-caption absolute inset-x-0 top-3 text-center font-black text-white">
                    coligo
                  </span>
                  <span className="text-nano absolute inset-x-2 top-1/2 -translate-y-1/2 rounded-md border border-dashed border-white/60 py-1 text-center font-mono font-bold text-white">
                    CODE
                  </span>
                  {active && (
                    <span className="absolute right-1.5 bottom-1.5 grid size-5 place-items-center rounded-full bg-white">
                      <Check className="text-primary-700 size-3.5" />
                    </span>
                  )}
                </span>
                <span className="text-label mt-1 block px-0.5 font-semibold">
                  {d.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Photo de la story */}
      <section className="border-border bg-surface rounded-lg border p-4">
        <h2 className="text-sm font-bold">Photo de la story</h2>
        <p className="text-muted text-body-sm mt-0.5">
          Optionnelle — dessinée en fond de la story, sous le voile du design
          choisi (les textes restent lisibles). Choisis une photo qui va avec le
          message : plat, livraison, ambiance…
        </p>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <span
            className="border-border rounded-control block h-40 w-[90px] shrink-0 overflow-hidden border bg-cover bg-center"
            style={{
              backgroundImage: settings.image_url
                ? `${overlayGradient(activeGradient)}, url(${settings.image_url})`
                : activeGradient,
            }}
            aria-label="Aperçu du fond de story"
          />
          <div className="min-w-48 flex-1 space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onPhotoPicked(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoPending}
              className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60"
            >
              {photoPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              {settings.image_url ? "Changer la photo" : "Ajouter une photo"}
            </button>
            {settings.image_url && (
              <button
                type="button"
                onClick={removePhoto}
                disabled={removePending}
                className="border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 ms-2 inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-60"
              >
                {removePending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Retirer
              </button>
            )}
            <p className="text-muted text-label">
              JPG/PNG/WebP, 5 Mo max. Idéal : portrait 1080×1920 (l&apos;image
              est recadrée pour couvrir).
            </p>
          </div>
        </div>
      </section>

      {/* Conditions (source unique : Parrainage) */}
      <section className="border-border bg-surface rounded-lg border p-4">
        <h2 className="text-sm font-bold">Cadeaux affichés au client</h2>
        <p className="text-muted text-body-sm mt-0.5">
          {referral?.enabled ? (
            <>
              Ami : <strong>+{formatDA(referral.reward_referee_da)}</strong> ·
              Partageur :{" "}
              <strong>+{formatDA(referral.reward_referrer_da)}</strong>
              {referral.min_order_da > 0 &&
                ` · dès ${formatDA(referral.min_order_da)} de commande`}
            </>
          ) : (
            "Parrainage DÉSACTIVÉ — la carte partage sans code ni cadeau."
          )}
        </p>
        <Link
          href="/admin/marketing/parrainage"
          prefetch
          className="text-primary-700 text-body-sm mt-2 inline-flex items-center gap-1.5 font-bold hover:underline"
        >
          Régler les conditions dans Parrainage
          <ExternalLink className="size-3.5" />
        </Link>
      </section>

      {error && (
        <p className="text-danger-700 bg-danger-50 rounded-md px-3 py-2 text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
