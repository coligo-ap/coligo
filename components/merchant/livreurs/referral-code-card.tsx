"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, RotateCw } from "lucide-react";
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

      {revealedCode && (
        <div className="border-success-200 bg-success-50 rounded-[12px] border px-4 py-3">
          <p className="text-success-700 text-xs font-medium tracking-wide uppercase">
            Nouveau code — note-le, il ne sera plus affiché
          </p>
          <div className="mt-2 flex items-center gap-3">
            <code className="text-success-900 flex-1 rounded-md bg-white px-3 py-2 font-mono text-base tracking-wider">
              {revealedCode}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={copy}
              className="shrink-0"
            >
              <Copy className="size-4" />
              Copier
            </Button>
          </div>
        </div>
      )}

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
