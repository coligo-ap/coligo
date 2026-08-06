"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  Download,
  Facebook,
  Ghost,
  Gift,
  Instagram,
  MessageCircle,
  PartyPopper,
  Share2,
} from "lucide-react";
import type { StoryDesign } from "@/lib/data/share-story";

// =============================================================================
// OrderShareCard — le MÉGAPHONE post-commande : sur une commande honorée, le
// client partage une « story » générée (canvas 1080×1920, DESIGN choisi par le
// super-admin dans Marketing > Story) via le partage natif OU un réseau précis
// (WhatsApp / Facebook / Instagram / Snapchat). La carte affiche clairement les
// DEUX cadeaux du parrainage (ami ET partageur), selon les conditions réglées
// dans Marketing > Parrainage. Chaque partage porte le code du client.
// =============================================================================

type ReferralLite = {
  code: string;
  reward_referrer_da: number;
  reward_referee_da: number;
  min_order_da: number;
  enabled: boolean;
} | null;

/** Palettes du canvas par design (dégradé haut → bas). */
const STORY_COLORS: Record<StoryDesign, [string, string, string]> = {
  violet: ["#8A4DFF", "#6C2BD9", "#4B1FA6"],
  rose: ["#FF2D7A", "#C2338F", "#6C2BD9"],
  nuit: ["#191036", "#2A1458", "#4B1FA6"],
  ambre: ["#F59E0B", "#F97316", "#FF2D7A"],
};

/** Dégradés Tailwind de la CARTE, assortis au design de la story. */
const CARD_GRADIENT: Record<StoryDesign, string> = {
  violet: "from-primary-500 via-primary-600 to-primary-800",
  rose: "from-accent-500 via-fuchsia-600 to-primary-700",
  nuit: "from-[#191036] via-[#2A1458] to-primary-800",
  ambre: "from-amber-500 via-orange-500 to-accent-500",
};

function drawStory(
  merchantName: string,
  code: string | null,
  rewardDa: number,
  link: string,
  design: StoryDesign
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const W = 1080;
      const H = 1920;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d");
      if (!ctx) return resolve(null);

      // Fond dégradé du DESIGN choisi + anneaux décoratifs.
      const [c1, c2, c3] = STORY_COLORS[design] ?? STORY_COLORS.violet;
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, c1);
      g.addColorStop(0.5, c2);
      g.addColorStop(1, c3);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 3;
      for (const [x, y, r] of [
        [980, 180, 260],
        [80, 1700, 300],
        [1010, 1500, 160],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";

      // Marque.
      ctx.font = "900 96px system-ui, sans-serif";
      ctx.fillText("coligo", W / 2, 300);
      ctx.fillStyle = "#FF2D7A";
      ctx.beginPath();
      ctx.arc(W / 2 + 168, 296, 14, 0, Math.PI * 2);
      ctx.fill();

      // Message principal.
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "700 52px system-ui, sans-serif";
      ctx.fillText("Je viens de commander chez", W / 2, 720);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 84px system-ui, sans-serif";
      const name =
        merchantName.length > 22
          ? merchantName.slice(0, 21) + "…"
          : merchantName;
      ctx.fillText(name, W / 2, 840);

      if (code) {
        // Coupon pointillé + code + récompense.
        ctx.setLineDash([18, 14]);
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 5;
        const bw = 640;
        ctx.strokeRect((W - bw) / 2, 1030, bw, 220);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = "700 40px system-ui, sans-serif";
        ctx.fillText("MON CODE", W / 2, 1105);
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 92px ui-monospace, monospace";
        ctx.fillText(code, W / 2, 1210);

        ctx.fillStyle = "#ffffff";
        ctx.font = "800 56px system-ui, sans-serif";
        ctx.fillText(`${rewardDa} DA offerts sur ta 1ʳᵉ commande`, W / 2, 1370);
      }

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "700 44px system-ui, sans-serif";
      ctx.fillText(link.replace(/^https?:\/\//, ""), W / 2, 1620);

      c.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
}

export function OrderShareCard({
  merchantName,
  referral,
  appUrl,
  design = "violet",
}: {
  merchantName: string;
  referral: ReferralLite;
  appUrl: string;
  /** Design de la story, choisi par le super-admin (Marketing > Story). */
  design?: StoryDesign;
}) {
  const t = useTranslations("referral");
  const [shared, setShared] = useState(false);
  const [saved, setSaved] = useState(false);

  const base = appUrl.replace(/\/+$/, "");
  const code = referral?.enabled ? referral.code : null;
  const rewardFriend = referral?.reward_referee_da ?? 0;
  const rewardMe = referral?.reward_referrer_da ?? 0;
  const minOrder = referral?.min_order_da ?? 0;
  const link = code ? `${base}/r/${code}` : base;
  const message = code
    ? t("shareMsg", {
        merchant: merchantName,
        code,
        amount: rewardFriend,
        link,
      })
    : t("shareMsgPlain", { merchant: merchantName, link });

  const flash = (set: (v: boolean) => void) => {
    set(true);
    setTimeout(() => set(false), 2200);
  };

  /** Feuille de partage SYSTÈME avec l'image de story (le client y choisit
   *  Instagram, Snapchat, WhatsApp… — seul canal fiable pour une story). */
  const nativeShare = async (): Promise<boolean> => {
    try {
      const blob = await drawStory(
        merchantName,
        code,
        rewardFriend,
        link,
        design
      );
      if (blob && typeof navigator.share === "function") {
        const file = new File([blob], "coligo-story.png", {
          type: "image/png",
        });
        const payload: ShareData = { text: message };
        if (
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] })
        ) {
          payload.files = [file];
        }
        await navigator.share(payload);
        flash(setShared);
        return true;
      }
    } catch {
      /* partage annulé / non supporté */
    }
    return false;
  };

  /** Sans partage natif (bureau) : on TÉLÉCHARGE la story + copie le message —
   *  le client la poste lui-même dans Instagram/Snapchat. */
  const downloadStory = async () => {
    const blob = await drawStory(
      merchantName,
      code,
      rewardFriend,
      link,
      design
    );
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coligo-story.png";
    a.click();
    URL.revokeObjectURL(url);
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      /* presse-papiers indisponible : l'image seule suffit */
    }
    flash(setSaved);
  };

  const shareStory = async () => {
    if (await nativeShare()) return;
    // Repli historique : WhatsApp texte.
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  /** Story d'abord (Instagram/Snapchat n'acceptent pas de texte pré-rempli) :
   *  feuille système avec l'image ; à défaut, téléchargement + message copié. */
  const shareToStoryApp = async () => {
    if (await nativeShare()) return;
    await downloadStory();
  };

  const networks: {
    key: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
  }[] = [
    {
      key: "whatsapp",
      label: "WhatsApp",
      Icon: MessageCircle,
      onClick: () =>
        window.open(
          `https://wa.me/?text=${encodeURIComponent(message)}`,
          "_blank",
          "noopener,noreferrer"
        ),
    },
    {
      key: "facebook",
      label: "Facebook",
      Icon: Facebook,
      onClick: () =>
        window.open(
          `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}&quote=${encodeURIComponent(message)}`,
          "_blank",
          "noopener,noreferrer"
        ),
    },
    {
      key: "instagram",
      label: "Instagram",
      Icon: Instagram,
      onClick: () => void shareToStoryApp(),
    },
    {
      key: "snapchat",
      label: "Snapchat",
      Icon: Ghost,
      onClick: () => void shareToStoryApp(),
    },
  ];

  return (
    <section
      className={`mt-2.5 overflow-hidden rounded-[16px] bg-gradient-to-br p-4 text-white ${CARD_GRADIENT[design] ?? CARD_GRADIENT.violet}`}
    >
      <p className="text-[15px] leading-snug font-extrabold">
        {t("shareCardTitle", { merchant: merchantName })}
      </p>

      {/* Les DEUX cadeaux, noir sur blanc : l'ami ET le partageur — montants
          réglés par l'équipe (Marketing > Parrainage). */}
      {code ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-bold">
            <Gift className="size-3.5" />
            {t("shareFriendGets", { amount: rewardFriend })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-bold">
            <PartyPopper className="size-3.5" />
            {t("shareYouGet", { amount: rewardMe })}
          </span>
          {minOrder > 0 && (
            <span className="text-[11px] font-medium text-white/70">
              {t("shareMinOrder", { amount: minOrder })}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-1 text-[12.5px] font-medium text-white/85">
          {t("shareCardBodyPlain")}
        </p>
      )}

      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={() => void shareStory()}
          className="text-primary-700 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3 text-sm font-extrabold shadow-sm transition-transform active:scale-[.98]"
        >
          {shared ? (
            <Check className="size-4" />
          ) : saved ? (
            <Download className="size-4" />
          ) : (
            <Share2 className="size-4" />
          )}
          {saved ? t("shareSaved") : t("shareCta")}
        </button>

        {/* Un bouton PAR réseau — le client choisit, plus de WhatsApp imposé. */}
        <div className="grid grid-cols-4 gap-2">
          {networks.map(({ key, label, Icon, onClick }) => (
            <button
              key={key}
              type="button"
              onClick={onClick}
              aria-label={label}
              className="flex flex-col items-center gap-1 rounded-[12px] bg-white/15 py-2 transition-colors hover:bg-white/25 active:scale-95"
            >
              <Icon className="size-5" />
              <span className="text-[10px] font-semibold text-white/85">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
