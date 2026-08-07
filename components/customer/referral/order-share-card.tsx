"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  Download,
  Gift,
  Loader2,
  PartyPopper,
  Share2,
} from "lucide-react";
import {
  siFacebook,
  siInstagram,
  siSnapchat,
  siTiktok,
  siWhatsapp,
} from "simple-icons";
import { isNative } from "@/lib/native/context";
import type { StoryDesign } from "@/lib/data/share-story";

// =============================================================================
// OrderShareCard — le MÉGAPHONE post-commande : l'app FABRIQUE le contenu
// partageable (story 1080×1920 avec le code parrainage + un QR qui ramène les
// gens), les réseaux le diffusent. Un bouton PAR réseau (WhatsApp, Facebook,
// Instagram, TikTok, Snapchat) avec son VRAI logo aux couleurs de sa marque.
//
// Plomberie de partage, en cascade (le clic fait TOUJOURS quelque chose et
// l'écrit inline — jamais de clic muet) :
//   1. APK : plugin Capacitor Share (image + texte dans la feuille système) —
//      en WebView Android, navigator.share N'EXISTE PAS et window.open est
//      muet : c'était le bug « rien ne se passe ».
//   2. Web mobile : navigator.share niveau 2 (fichiers).
//   3. Repli : message copié (+ story téléchargée sur web) + ouverture de
//      l'app du réseau (scheme natif) — avec le résultat écrit sous la grille.
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

/** Logo de marque officiel (simple-icons) — reconnaissable au premier regard. */
function BrandIcon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

/** QR du lien de parrainage, rendu en <img> prêt à dessiner sur le canvas. */
async function qrImage(
  text: string,
  px: number
): Promise<HTMLImageElement | null> {
  try {
    const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
    const svg = new BrowserQRCodeSvgWriter().write(text, px, px);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = rej;
      img.src = url;
    });
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

async function drawStory(
  merchantName: string,
  code: string | null,
  rewardDa: number,
  link: string,
  design: StoryDesign
): Promise<Blob | null> {
  try {
    const W = 1080;
    const H = 1920;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

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
    ctx.fillText("coligo", W / 2, 280);
    ctx.fillStyle = "#FF2D7A";
    ctx.beginPath();
    ctx.arc(W / 2 + 168, 276, 14, 0, Math.PI * 2);
    ctx.fill();

    // Message principal.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "700 52px system-ui, sans-serif";
    ctx.fillText("Je viens de commander chez", W / 2, 560);
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 84px system-ui, sans-serif";
    const name =
      merchantName.length > 22 ? merchantName.slice(0, 21) + "…" : merchantName;
    ctx.fillText(name, W / 2, 680);

    if (code) {
      // Coupon pointillé + code + récompense.
      ctx.setLineDash([18, 14]);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 5;
      const bw = 640;
      ctx.strokeRect((W - bw) / 2, 820, bw, 220);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "700 40px system-ui, sans-serif";
      ctx.fillText("MON CODE", W / 2, 895);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 92px ui-monospace, monospace";
      ctx.fillText(code, W / 2, 1000);

      ctx.fillStyle = "#ffffff";
      ctx.font = "800 56px system-ui, sans-serif";
      ctx.fillText(`${rewardDa} DA offerts sur ta 1ʳᵉ commande`, W / 2, 1140);
    }

    // QR qui RAMÈNE les gens : boîte blanche arrondie + QR du lien + légende.
    const qr = await qrImage(link, 560);
    if (qr) {
      const box = 400;
      const bx = (W - box) / 2;
      const by = code ? 1250 : 1000;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(bx, by, box, box, 28);
      ctx.fill();
      ctx.drawImage(qr, bx + 30, by + 30, box - 60, box - 60);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "700 42px system-ui, sans-serif";
      ctx.fillText("Scanne pour t'inscrire", W / 2, by + box + 80);
    }

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 44px system-ui, sans-serif";
    ctx.fillText(link.replace(/^https?:\/\//, ""), W / 2, 1800);

    return await new Promise((resolve) =>
      c.toBlob((b) => resolve(b), "image/png")
    );
  } catch {
    return null;
  }
}

/** Plugins Capacitor résolus dynamiquement (vieil APK sans plugin ⇒ repli). */
type CapShare = { share: (o: object) => Promise<unknown> };
type CapFilesystem = { writeFile: (o: object) => Promise<{ uri: string }> };

function capPlugins(): { Share?: CapShare; Filesystem?: CapFilesystem } {
  if (typeof window === "undefined" || !isNative()) return {};
  const plugins = (
    window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }
  ).Capacitor?.Plugins;
  return {
    Share: plugins?.Share as CapShare | undefined,
    Filesystem: plugins?.Filesystem as CapFilesystem | undefined,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/**
 * Feuille de partage SYSTÈME avec l'image (le client y choisit son réseau).
 * true si la feuille s'est ouverte — APK via plugin natif, web mobile via
 * navigator.share ; false = aucun canal (bureau, vieil APK) ⇒ repli appelant.
 */
async function shareImageSheet(blob: Blob, message: string): Promise<boolean> {
  const { Share, Filesystem } = capPlugins();
  if (Share && Filesystem) {
    try {
      const data = await blobToBase64(blob);
      const written = await Filesystem.writeFile({
        path: "coligo-story.png",
        data,
        directory: "CACHE",
      });
      // La feuille s'est ouverte : une annulation utilisateur rejette aussi —
      // ce n'est PAS un échec de canal, on ne bascule pas sur le repli.
      await Share.share({ text: message, files: [written.uri] }).catch(
        () => {}
      );
      return true;
    } catch {
      /* écriture impossible → tenter les canaux suivants */
    }
  }
  try {
    if (typeof navigator.share === "function") {
      const file = new File([blob], "coligo-story.png", { type: "image/png" });
      const payload: ShareData = { text: message };
      if (
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        payload.files = [file];
      }
      await navigator.share(payload);
      return true;
    }
  } catch {
    /* partage annulé — la feuille s'était ouverte */
    return true;
  }
  return false;
}

/**
 * Ouvre une URL/scheme EXTERNE de façon fiable : en WebView Capacitor,
 * window.open est souvent muet — la navigation main-frame, elle, part en
 * Intent système (l'app cible s'ouvre, la nôtre reste). Sur web, popup avec
 * repli navigation si bloquée.
 */
function openExternal(url: string) {
  if (isNative()) {
    window.location.href = url;
    return;
  }
  // PAS de feature "noopener" ici : window.open la respecte en renvoyant NULL
  // MÊME quand l'onglet s'ouvre (spec) — impossible alors de distinguer un
  // popup bloqué, et le repli naviguerait la page principale hors de l'app.
  // On coupe `opener` à la main : même protection, détection fiable.
  const w = window.open(url, "_blank");
  if (w) {
    try {
      w.opener = null;
    } catch {
      /* cross-origin : déjà isolé */
    }
    return;
  }
  window.location.href = url; // popup réellement bloqué → navigation franche
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
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Résultat INLINE sous la grille : chaque clic écrit ce qui s'est passé.
  const [status, setStatus] = useState<string | null>(null);

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

  const story = () => drawStory(merchantName, code, rewardFriend, link, design);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      return true;
    } catch {
      return false;
    }
  };

  const downloadStory = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coligo-story.png";
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Feuille système d'abord ; sinon story + message prêts à coller, dit inline. */
  const shareVia = async (key: string, appLabel: string, scheme?: string) => {
    if (busy) return;
    setBusy(key);
    setStatus(null);
    try {
      const blob = await story();
      if (blob && (await shareImageSheet(blob, message))) {
        setDone(true);
        setTimeout(() => setDone(false), 2200);
        return;
      }
      const copied = await copyMessage();
      if (blob && !isNative()) downloadStory(blob);
      setStatus(
        !isNative() && blob
          ? t("shareSavedCopied", { app: appLabel })
          : copied
            ? t("shareCopiedOpen", { app: appLabel })
            : t("shareReadyPlain", { app: appLabel })
      );
      if (isNative() && scheme) openExternal(scheme);
    } finally {
      setBusy(null);
    }
  };

  /** Réseaux à LIEN texte direct (le message part tel quel, avec le lien). */
  const shareLink = (key: string, appLabel: string, url: string) => {
    if (busy) return;
    setBusy(key);
    setStatus(t("shareOpening", { app: appLabel }));
    openExternal(url);
    setTimeout(() => {
      setBusy(null);
      setStatus(null);
    }, 2600);
  };

  const networks: {
    key: string;
    label: string;
    path: string;
    /** Couleur de marque du chip — logo blanc dessus. */
    chip: string;
    glyph?: string;
    onClick: () => void;
  }[] = [
    {
      key: "whatsapp",
      label: "WhatsApp",
      path: siWhatsapp.path,
      chip: "#25D366",
      onClick: () =>
        shareLink(
          "whatsapp",
          "WhatsApp",
          `https://wa.me/?text=${encodeURIComponent(message)}`
        ),
    },
    {
      key: "facebook",
      label: "Facebook",
      path: siFacebook.path,
      chip: "#0866FF",
      onClick: () =>
        shareLink(
          "facebook",
          "Facebook",
          `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}&quote=${encodeURIComponent(message)}`
        ),
    },
    {
      key: "instagram",
      label: "Instagram",
      path: siInstagram.path,
      chip: "#FF0069",
      onClick: () =>
        void shareVia("instagram", "Instagram", "instagram://story-camera"),
    },
    {
      key: "tiktok",
      label: "TikTok",
      path: siTiktok.path,
      chip: "#111111",
      onClick: () => void shareVia("tiktok", "TikTok", "snssdk1233://"),
    },
    {
      key: "snapchat",
      label: "Snapchat",
      path: siSnapchat.path,
      chip: "#FFFC00",
      // Jaune Snapchat : fantôme NOIR, sinon logo invisible sur le chip.
      glyph: "#111111",
      onClick: () => void shareVia("snapchat", "Snapchat", "snapchat://"),
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
          onClick={() => void shareVia("main", t("shareTargetStory"))}
          disabled={busy === "main"}
          className="text-primary-700 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3 text-sm font-extrabold shadow-sm transition-transform active:scale-[.98] disabled:opacity-80"
        >
          {busy === "main" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : done ? (
            <Check className="size-4" />
          ) : status ? (
            <Download className="size-4" />
          ) : (
            <Share2 className="size-4" />
          )}
          {t("shareCta")}
        </button>

        {/* Un bouton PAR réseau, avec son VRAI logo aux couleurs de sa marque. */}
        <div className="grid grid-cols-5 gap-1.5">
          {networks.map(({ key, label, path, chip, glyph, onClick }) => (
            <button
              key={key}
              type="button"
              onClick={onClick}
              aria-label={label}
              className="flex flex-col items-center gap-1 rounded-[12px] bg-white/10 py-2 transition-colors hover:bg-white/20 active:scale-95"
            >
              <span
                className="inline-flex size-8 items-center justify-center rounded-full"
                style={{ backgroundColor: chip, color: glyph ?? "#ffffff" }}
              >
                {busy === key ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BrandIcon path={path} className="size-[18px]" />
                )}
              </span>
              <span className="text-[9.5px] font-semibold text-white/85">
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* Résultat inline — le clic écrit TOUJOURS ce qui s'est passé. */}
        {status && (
          <p className="rounded-[10px] bg-white/15 px-3 py-2 text-[12px] leading-snug font-semibold">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
