"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/toast";

/**
 * Connexion sociale client (Google). Redirige vers le provider puis revient sur
 * /auth/callback qui crée le profil et renvoie vers `next`. Le provider doit
 * être activé dans le Dashboard Supabase + les URLs de redirection allowlistées.
 */
export function SocialAuth({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const [loading, setLoading] = useState(false);

  async function signInGoogle() {
    setLoading(true);
    try {
      const supabase = createClient();
      const params =
        next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback${params}`,
        },
      });
      if (error) {
        setLoading(false);
        toast.error(error.message);
      }
      // Succès → le navigateur est redirigé vers Google automatiquement.
    } catch {
      setLoading(false);
      toast.error(t("googleUnavailable"));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="border-border h-px flex-1 border-t" />
        <span className="text-subtle text-xs font-medium">{t("or")}</span>
        <span className="border-border h-px flex-1 border-t" />
      </div>

      <button
        type="button"
        onClick={signInGoogle}
        disabled={loading}
        className="border-border bg-surface hover:bg-surface-2 flex h-12 w-full items-center justify-center gap-3 rounded-[12px] border text-sm font-bold transition-colors disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GoogleIcon className="size-5" />
        )}
        {t("continueWithGoogle")}
      </button>
    </div>
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
