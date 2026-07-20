"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  canUseNativeGoogle,
  NativeGoogleError,
} from "@/lib/native/google-signin";
import { canUseNativeApple, NativeAppleError } from "@/lib/native/apple-signin";
import { isNative as isNativeApp } from "@/lib/native/context";
import {
  signInWithGoogleNative,
  signInWithAppleNative,
} from "@/app/auth/actions";

/**
 * Connexions sociales du client — Apple ET Google. Deux chemins par provider :
 *
 *  • APK (Capacitor) → feuille NATIVE (WebView à cookies isolés ; Google et
 *    Apple refusent l'OAuth en WebView embarquée). Le natif rend un `id_token`
 *    échangé côté serveur (`signInWith*Native`).
 *  • Web (PWA/navigateur) → OAuth classique, retour sur `/auth/callback`.
 *
 * Apple (App Store 4.8) DOIT être proposé partout où Google l'est, sur iOS. Il
 * est masqué sur Android NATIF (Google Play ne l'impose pas ; l'Apple natif n'y
 * est pas pertinent) mais reste dispo sur le web.
 *
 * Les deux provisionnent le profil par `provisionSocialUser`, jamais deux fois.
 * Les providers doivent être activés dans Supabase + URLs de redirection
 * allowlistées. `intent="merchant"` cible l'espace COMMERÇANT (libellés FR figés).
 */
export function SocialAuth({
  next,
  intent = "customer",
  labels,
}: {
  next?: string;
  intent?: "customer" | "merchant";
  labels?: { or: string; button: string; error: string };
}) {
  const t = useTranslations("auth");
  const merchantDefaults =
    intent === "merchant"
      ? {
          or: "ou",
          google: "Continuer avec Google",
          apple: "Continuer avec Apple",
          error: "La connexion a échoué. Réessayez.",
        }
      : null;
  const or = labels?.or ?? merchantDefaults?.or ?? t("or");
  const googleLabel =
    labels?.button ?? merchantDefaults?.google ?? t("continueWithGoogle");
  const appleLabel = merchantDefaults?.apple ?? t("continueWithApple");
  const googleError =
    labels?.error ?? merchantDefaults?.error ?? t("googleAuthFailed");
  const appleError = merchantDefaults?.error ?? t("appleAuthFailed");
  const nativeUnavailableLabel =
    intent === "merchant"
      ? "Connexion Google bientôt disponible dans l'app — utilisez votre email."
      : t("googleNativeUnavailable");

  const [loading, setLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Apple : iOS natif (feuille native) OU web (OAuth). Masqué sur Android natif.
  const showApple = canUseNativeApple() || !isNativeApp();

  const oauthRedirect = () => {
    const qs = new URLSearchParams();
    if (next && next !== "/") qs.set("next", next);
    if (intent !== "customer") qs.set("intent", intent);
    const params = qs.size > 0 ? `?${qs.toString()}` : "";
    return `${window.location.origin}/auth/callback${params}`;
  };

  /* ─────────────── Google ─────────────── */
  async function signInGoogle() {
    setLoading("google");
    setError(null);
    try {
      if (canUseNativeGoogle()) {
        const { nativeGoogleIdToken } =
          await import("@/lib/native/google-signin");
        const { idToken, nonce } = await nativeGoogleIdToken();
        const res = await signInWithGoogleNative({
          idToken,
          nonce,
          next,
          intent,
        });
        if (res?.error) setError(res.error);
      } else if (isNativeApp()) {
        setError(nativeUnavailableLabel);
        setLoading(null);
        return;
      } else {
        const supabase = createClient();
        const { error: err } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: oauthRedirect() },
        });
        if (err) throw new Error(err.message);
      }
    } catch (e) {
      if (e instanceof NativeGoogleError && e.cancelled) {
        setLoading(null);
        return;
      }
      console.error("connexion Google :", e);
      const detail =
        isNativeApp() && e instanceof Error && e.message
          ? ` (${e.message.slice(0, 140)})`
          : "";
      setError(googleError + detail);
      setLoading(null);
      return;
    }
    setLoading(null);
  }

  /* ─────────────── Apple ─────────────── */
  async function signInApple() {
    setLoading("apple");
    setError(null);
    try {
      if (canUseNativeApple()) {
        const { nativeAppleIdToken } =
          await import("@/lib/native/apple-signin");
        const { idToken } = await nativeAppleIdToken();
        const res = await signInWithAppleNative({ idToken, next, intent });
        if (res?.error) setError(res.error);
      } else {
        // Web : OAuth Apple classique, retour sur /auth/callback.
        const supabase = createClient();
        const { error: err } = await supabase.auth.signInWithOAuth({
          provider: "apple",
          options: { redirectTo: oauthRedirect() },
        });
        if (err) throw new Error(err.message);
      }
    } catch (e) {
      if (e instanceof NativeAppleError && e.cancelled) {
        setLoading(null);
        return;
      }
      console.error("connexion Apple :", e);
      const detail =
        isNativeApp() && e instanceof Error && e.message
          ? ` (${e.message.slice(0, 140)})`
          : "";
      setError(appleError + detail);
      setLoading(null);
      return;
    }
    setLoading(null);
  }

  const busy = loading !== null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="border-border h-px flex-1 border-t" />
        <span className="text-subtle text-xs font-medium">{or}</span>
        <span className="border-border h-px flex-1 border-t" />
      </div>

      {/* Apple d'abord (recommandation HIG) — masqué sur Android natif. */}
      {showApple && (
        <button
          type="button"
          onClick={signInApple}
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] bg-black text-sm font-bold text-white transition-colors hover:bg-neutral-800 disabled:opacity-60"
        >
          {loading === "apple" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <AppleIcon className="size-[18px]" />
          )}
          {appleLabel}
        </button>
      )}

      <button
        type="button"
        onClick={signInGoogle}
        disabled={busy}
        className="border-border bg-surface hover:bg-surface-2 flex h-12 w-full items-center justify-center gap-3 rounded-[12px] border text-sm font-bold transition-colors disabled:opacity-60"
      >
        {loading === "google" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GoogleIcon className="size-5" />
        )}
        {googleLabel}
      </button>

      {error && (
        <p
          role="alert"
          className="text-danger-600 text-center text-xs font-medium"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
