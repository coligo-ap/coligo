"use client";

/**
 * Gestion 2FA TOTP côté super-admin.
 *
 * Trois états :
 *  1. Aucun factor verified → bouton « Activer la 2FA » qui lance enroll().
 *  2. Enroll en cours → on affiche le QR code + la clé manuelle, l'admin
 *     scanne avec Google Authenticator / Authy et saisit le code à
 *     6 chiffres pour confirmer (= mfa.challenge + mfa.verify).
 *  3. Factor verified → on affiche les infos du factor + bouton « Désactiver ».
 *
 * Tout passe par le browser client (les méthodes `auth.mfa.*` ont besoin
 * de la session JWT actuelle côté navigateur, pas du service role).
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type ActiveFactor = {
  id: string;
  friendlyName: string | null;
  createdAt: string;
};

type Props = {
  activeFactor: ActiveFactor | null;
};

type EnrollState = {
  factorId: string;
  qrSvg: string; // dataurl SVG ou raw SVG renvoyé par Supabase
  secret: string;
};

export function MfaTotpManager({ activeFactor }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function startEnroll() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      // Nettoie un éventuel ancien factor unverified (Supabase rejette
      // un 2e enroll TOTP simultané pour le même user).
      const { data: list } = await supabase.auth.mfa.listFactors();
      const stale = list?.totp?.find((f) => f.status !== "verified");
      if (stale) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }

      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Coligo Admin · ${new Date().toLocaleDateString("fr-DZ")}`,
      });
      if (enrollErr || !data) {
        setError(
          enrollErr?.message ?? "Impossible de démarrer l'enrôlement 2FA."
        );
        return;
      }
      setEnroll({
        factorId: data.id,
        qrSvg: data.totp.qr_code,
        secret: data.totp.secret,
      });
    });
  }

  async function cancelEnroll() {
    if (!enroll) return;
    startTransition(async () => {
      await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
      setEnroll(null);
      setCode("");
      setError(null);
    });
  }

  async function verifyEnroll() {
    if (!enroll) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Le code doit comporter 6 chiffres.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: enroll.factorId,
      });
      if (chErr || !ch) {
        setError(chErr?.message ?? "Challenge MFA refusé.");
        return;
      }
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: ch.id,
        code,
      });
      if (vErr) {
        setError(vErr.message ?? "Code invalide. Réessayez.");
        return;
      }
      setEnroll(null);
      setCode("");
      setSuccess(
        "2FA activée. Conservez votre application d'authentification."
      );
      router.refresh();
    });
  }

  async function disable() {
    if (!activeFactor) return;
    const ok = confirm(
      "Désactiver la 2FA ? Le compte super-admin sera protégé uniquement par mot de passe."
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const { error: uErr } = await supabase.auth.mfa.unenroll({
        factorId: activeFactor.id,
      });
      if (uErr) {
        setError(uErr.message ?? "Erreur lors de la désactivation.");
        return;
      }
      setSuccess("2FA désactivée.");
      router.refresh();
    });
  }

  // ─── État 3 : factor verified actif ──────────────────────────────────
  if (activeFactor && !enroll) {
    return (
      <div className="border-success-200 bg-success-50 rounded-[16px] border p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-success-600 mt-0.5 size-5 shrink-0" />
          <div className="flex-1">
            <p className="text-success-800 font-semibold">
              Vérification en 2 étapes active
            </p>
            <p className="text-success-700 mt-1 text-sm">
              Un code à 6 chiffres est demandé à chaque connexion au panneau
              admin.
            </p>
            <dl className="text-success-800 mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="opacity-70">Nom</dt>
              <dd className="font-medium">
                {activeFactor.friendlyName ?? "TOTP"}
              </dd>
              <dt className="opacity-70">Activée le</dt>
              <dd className="font-medium">
                {new Date(activeFactor.createdAt).toLocaleDateString("fr-DZ")}
              </dd>
            </dl>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={disable}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <X className="size-4" />
              )}
              Désactiver la 2FA
            </Button>
          </div>
        </div>
        {success && <p className="text-success-700 mt-3 text-xs">{success}</p>}
        {error && <p className="text-danger-600 mt-3 text-xs">{error}</p>}
      </div>
    );
  }

  // ─── État 2 : enroll en cours, attente du code ───────────────────────
  if (enroll) {
    return (
      <div className="border-border bg-surface rounded-[16px] border p-5">
        <h2 className="font-semibold">Scanner avec votre application 2FA</h2>
        <p className="text-muted mt-1 text-sm">
          Utilisez Google Authenticator, Authy, ou 1Password. Scannez le QR ou
          entrez la clé manuellement.
        </p>

        <div className="mt-4 flex flex-col items-center gap-3">
          {/* Supabase renvoie un SVG inline en string. On l'injecte tel quel. */}
          <div
            className="bg-white p-3 ring-1 ring-black/10"
            dangerouslySetInnerHTML={{ __html: enroll.qrSvg }}
          />
          <div className="text-center">
            <p className="text-muted text-xs">Clé manuelle (base32)</p>
            <code className="bg-surface-2 mt-1 inline-block rounded-[8px] px-3 py-1 font-mono text-xs tracking-widest">
              {enroll.secret}
            </code>
          </div>
        </div>

        <div className="mt-5 border-t pt-4">
          <label
            htmlFor="mfa-code"
            className="text-foreground text-sm font-medium"
          >
            Code de vérification (6 chiffres)
          </label>
          <input
            id="mfa-code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            autoFocus
            disabled={pending}
            placeholder="000000"
            className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 mt-2 block w-full rounded-[12px] border px-4 py-2.5 text-center text-xl font-semibold tracking-[0.4em] tabular-nums focus:ring-2 focus:outline-none disabled:opacity-50"
          />

          {error && <p className="text-danger-600 mt-2 text-xs">{error}</p>}

          <div className="mt-4 flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={verifyEnroll}
              disabled={pending || code.length !== 6}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Activer
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={cancelEnroll}
              disabled={pending}
            >
              Annuler
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── État 1 : pas de 2FA active ───────────────────────────────────────
  return (
    <div className="border-warning-200 bg-warning-50 rounded-[16px] border p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert className="text-warning-700 mt-0.5 size-5 shrink-0" />
        <div className="flex-1">
          <p className="text-warning-800 font-semibold">
            Vérification en 2 étapes désactivée
          </p>
          <p className="text-warning-700 mt-1 text-sm">
            Le panneau admin est protégé uniquement par votre mot de passe.
            Activez la 2FA pour ajouter un code à 6 chiffres (Google
            Authenticator, Authy, 1Password…).
          </p>
          <Button
            size="sm"
            className="mt-4"
            onClick={startEnroll}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            Activer la 2FA
          </Button>
          {success && (
            <p className="text-success-700 mt-3 text-xs">{success}</p>
          )}
          {error && <p className="text-danger-600 mt-3 text-xs">{error}</p>}
        </div>
      </div>
    </div>
  );
}
