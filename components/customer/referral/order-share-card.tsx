"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, MessageCircle, Share2 } from "lucide-react";

// =============================================================================
// OrderShareCard — le MÉGAPHONE post-commande : sur une commande honorée, le
// client partage une « story » générée (canvas 1080×1920 aux couleurs Coligo,
// commerçant + code de parrainage) via le partage natif ; repli WhatsApp texte.
// Chaque commande devient une pub — et chaque partage porte le code du client
// (acquisition parrainage intégrée).
// =============================================================================

type ReferralLite = {
  code: string;
  reward_referee_da: number;
  enabled: boolean;
} | null;

function drawStory(
  merchantName: string,
  code: string | null,
  rewardDa: number,
  link: string
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

      // Fond dégradé violet marque + anneaux décoratifs.
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#8A4DFF");
      g.addColorStop(0.5, "#6C2BD9");
      g.addColorStop(1, "#4B1FA6");
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
}: {
  merchantName: string;
  referral: ReferralLite;
  appUrl: string;
}) {
  const t = useTranslations("referral");
  const [shared, setShared] = useState(false);

  const base = appUrl.replace(/\/+$/, "");
  const code = referral?.enabled ? referral.code : null;
  const reward = referral?.reward_referee_da ?? 0;
  const link = code ? `${base}/r/${code}` : base;
  const message = code
    ? t("shareMsg", { merchant: merchantName, code, amount: reward, link })
    : t("shareMsgPlain", { merchant: merchantName, link });
  const waHref = `https://wa.me/?text=${encodeURIComponent(message)}`;

  const shareStory = async () => {
    // Story image via partage natif quand possible (mobile / APK) — sinon
    // repli WhatsApp texte (même message, même lien).
    try {
      const blob = await drawStory(merchantName, code, reward, link);
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
        setShared(true);
        setTimeout(() => setShared(false), 2000);
        return;
      }
    } catch {
      /* partage annulé / non supporté → repli WhatsApp ci-dessous */
    }
    window.open(waHref, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="from-primary-500 via-primary-600 to-primary-800 mt-2.5 overflow-hidden rounded-[16px] bg-gradient-to-br p-4 text-white">
      <p className="text-[15px] leading-snug font-extrabold">
        {t("shareCardTitle", { merchant: merchantName })}
      </p>
      <p className="mt-1 text-[12.5px] font-medium text-white/85">
        {code
          ? t("shareCardBody", { amount: reward })
          : t("shareCardBodyPlain")}
      </p>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={() => void shareStory()}
          className="text-primary-700 inline-flex items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3 text-sm font-extrabold shadow-sm transition-transform active:scale-[.98]"
        >
          {shared ? (
            <Check className="size-4" />
          ) : (
            <Share2 className="size-4" />
          )}
          {t("shareCta")}
        </button>
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("shareWhatsapp")}
          className="grid size-11 place-items-center self-center rounded-[12px] bg-white/15 transition-colors hover:bg-white/25 active:scale-95"
        >
          <MessageCircle className="size-5" />
        </a>
      </div>
    </section>
  );
}
