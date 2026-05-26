"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Link2, Loader2, RotateCw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import {
  regenerateReferralCode,
  setReferralCodeExpiration,
} from "@/app/(merchant)/livreurs/actions";

export function ReferralCodeCard({
  hasActiveCode,
  expiresAt,
  createdAt,
}: {
  merchantSlug: string;
  hasActiveCode: boolean;
  expiresAt: string | null;
  createdAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string>(
    expiresAt ? new Date(expiresAt).toISOString().slice(0, 10) : ""
  );

  const onGenerate = () =>
    startTransition(async () => {
      const ok = confirm(
        hasActiveCode
          ? "Régénérer le code va désactiver l'ancien et déconnecter TOUS les livreurs actifs (ils devront re-soumettre le nouveau code). Continuer ?"
          : "Générer un nouveau code de référence ?"
      );
      if (!ok) return;
      const res = await regenerateReferralCode({
        expiresAt: expiry ? new Date(expiry).toISOString() : null,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (res.newCode) {
        setRevealedCode(res.newCode);
      }
      toast.success(res.success ?? "Code généré");
      router.refresh();
    });

  const onSaveExpiry = () =>
    startTransition(async () => {
      const res = await setReferralCodeExpiration(
        expiry ? new Date(expiry).toISOString() : null
      );
      if (res.error) toast.error(res.error);
      else toast.success(res.success ?? "Expiration mise à jour");
      router.refresh();
    });

  const copy = () => {
    if (!revealedCode) return;
    void navigator.clipboard.writeText(revealedCode).then(() => {
      toast.success("Code copié");
    });
  };

  return (
    <section className="border-border bg-surface space-y-4 rounded-[16px] border p-5">
      <header className="flex items-center gap-2">
        <KeyRound className="size-4" />
        <h2 className="text-base font-semibold tracking-tight">
          Code de référence
        </h2>
      </header>

      {!hasActiveCode && !revealedCode && (
        <p className="text-muted text-sm">
          Pas encore de code actif. Génère-en un pour le partager à tes futurs
          livreurs.
        </p>
      )}

      {hasActiveCode && !revealedCode && (
        <div className="bg-surface-2 rounded-[12px] p-3 text-sm">
          <p className="font-medium">Un code actif existe.</p>
          <p className="text-muted mt-1 text-xs">
            Pour des raisons de sécurité, le code en clair n&apos;est PAS
            réaffiché. Si tu l&apos;as perdu, régénère-en un nouveau (les
            livreurs actifs devront re-soumettre).
          </p>
          {createdAt && (
            <p className="text-subtle mt-2 text-xs">
              Créé le {new Date(createdAt).toLocaleDateString("fr-FR")}
              {expiresAt &&
                ` · expire le ${new Date(expiresAt).toLocaleDateString("fr-FR")}`}
            </p>
          )}
        </div>
      )}

      {revealedCode && <ShareCodePanel code={revealedCode} onCopy={copy} />}

      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="expires_at">Expiration (optionnelle)</Label>
          <Input
            id="expires_at"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            disabled={pending}
          />
        </div>
        {hasActiveCode && (
          <Button
            type="button"
            variant="secondary"
            onClick={onSaveExpiry}
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Mettre à jour
          </Button>
        )}
        <Button type="button" onClick={onGenerate} disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCw className="size-4" />
          )}
          {hasActiveCode ? "Régénérer" : "Générer"}
        </Button>
      </div>
    </section>
  );
}

/**
 * Affiche le code en clair + un lien partageable + 3 boutons (copier code,
 * copier lien, partager via Web Share API / WhatsApp / SMS). Le lien mène
 * à `/driver/codes?code=XXX` qui pré-remplit le champ du livreur — si le
 * livreur n'a pas encore de compte, le flux d'auth se déclenche d'abord.
 */
function ShareCodePanel({
  code,
  onCopy,
}: {
  code: string;
  onCopy: () => void;
}) {
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/driver/codes?code=${encodeURIComponent(code)}`
      : `/driver/codes?code=${encodeURIComponent(code)}`;

  const inviteText = `Salam ! Tu peux rejoindre ma boutique sur Coligo comme livreur. Clique ce lien pour activer ton accès : ${link}\n\nOu saisis ce code manuellement : ${code}`;

  const copyLink = () => {
    void navigator.clipboard.writeText(link).then(() => {
      toast.success("Lien copié");
    });
  };

  const shareWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareSms = () => {
    const url = `sms:?body=${encodeURIComponent(inviteText)}`;
    window.location.href = url;
  };

  const shareNative = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "Rejoins ma boutique Coligo comme livreur",
          text: inviteText,
          url: link,
        });
      } catch {
        /* user cancelled */
      }
    } else {
      copyLink();
    }
  };

  return (
    <div className="border-success-200 bg-success-50 space-y-3 rounded-[12px] border px-4 py-3">
      <p className="text-success-700 text-xs font-medium tracking-wide uppercase">
        Nouveau code — note-le, il ne sera plus affiché
      </p>

      {/* Code en clair + bouton copier code */}
      <div className="flex items-center gap-2">
        <code className="text-success-900 flex-1 rounded-md bg-white px-3 py-2 font-mono text-base tracking-wider">
          {code}
        </code>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onCopy}
          title="Copier le code"
        >
          <Copy className="size-4" />
        </Button>
      </div>

      {/* Lien partageable */}
      <div className="space-y-1.5">
        <Label className="text-success-900 text-xs">
          Lien à partager (pré-remplit le code chez le livreur)
        </Label>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link}
            className="border-success-200 flex-1 rounded-md border bg-white px-2.5 py-1.5 text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={copyLink}
            title="Copier le lien"
          >
            <Link2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Partage rapide */}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={shareWhatsApp}
        >
          <span className="text-base leading-none">💬</span>
          WhatsApp
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={shareSms}>
          <span className="text-base leading-none">📱</span>
          SMS
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={shareNative}
        >
          <Share2 className="size-4" />
          Partager…
        </Button>
      </div>

      <p className="text-success-800 text-xs">
        Le livreur peut soit cliquer le lien (s&apos;il est inscrit, le code est
        validé directement), soit saisir le code à la main.
      </p>
    </div>
  );
}
