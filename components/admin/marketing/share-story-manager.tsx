"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Power } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { setShareStorySettings } from "@/app/admin/marketing/actions";
import type { ShareStorySettings, StoryDesign } from "@/lib/data/share-story";

// =============================================================================
// ShareStoryManager — Marketing > Story : le PARTAGE STORY post-commande.
// L'équipe active/désactive la carte sur les commandes livrées et choisit le
// DESIGN de la story générée (aperçu = les vrais dégradés du canvas).
// Les CONDITIONS (cadeaux parrain/filleul, minimum) se règlent dans Parrainage.
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
];

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
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [togglePending, startToggle] = useTransition();
  const [designPending, startDesign] = useTransition();

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

  return (
    <div className="space-y-4">
      {/* Activation */}
      <section className="border-border bg-surface rounded-[16px] border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">
              Carte de partage post-commande
            </h2>
            <p className="text-muted mt-0.5 text-[13px]">
              Sur chaque commande livrée : story générée + code parrain du
              client, partage WhatsApp / Facebook / Instagram / Snapchat.
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={togglePending}
            className={cn(
              "inline-flex items-center gap-2 rounded-[12px] px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60",
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
      <section className="border-border bg-surface rounded-[16px] border p-4">
        <h2 className="text-sm font-bold">Design de la story</h2>
        <p className="text-muted mt-0.5 text-[13px]">
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
                  "rounded-[14px] border-2 p-1.5 text-left transition-all disabled:opacity-60",
                  active
                    ? "border-primary-600 ring-primary-500/25 ring-2"
                    : "border-border hover:border-primary-300"
                )}
              >
                <span
                  className="relative block aspect-9/16 max-h-36 w-full overflow-hidden rounded-[10px]"
                  style={{ background: d.gradient }}
                >
                  <span className="absolute inset-x-0 top-3 text-center text-[11px] font-black text-white">
                    coligo
                  </span>
                  <span className="absolute inset-x-2 top-1/2 -translate-y-1/2 rounded-md border border-dashed border-white/60 py-1 text-center font-mono text-[9px] font-bold text-white">
                    CODE
                  </span>
                  {active && (
                    <span className="absolute right-1.5 bottom-1.5 grid size-5 place-items-center rounded-full bg-white">
                      <Check className="text-primary-700 size-3.5" />
                    </span>
                  )}
                </span>
                <span className="mt-1 block px-0.5 text-[12px] font-semibold">
                  {d.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Conditions (source unique : Parrainage) */}
      <section className="border-border bg-surface rounded-[16px] border p-4">
        <h2 className="text-sm font-bold">Cadeaux affichés au client</h2>
        <p className="text-muted mt-0.5 text-[13px]">
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
          className="text-primary-700 mt-2 inline-flex items-center gap-1.5 text-[13px] font-bold hover:underline"
        >
          Régler les conditions dans Parrainage
          <ExternalLink className="size-3.5" />
        </Link>
      </section>

      {error && (
        <p className="text-danger-700 bg-danger-50 rounded-[12px] px-3 py-2 text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
