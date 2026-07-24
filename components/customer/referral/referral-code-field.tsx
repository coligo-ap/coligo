"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Gift, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

/**
 * Champ « code de parrainage » du formulaire d'inscription.
 *
 * - Replié par défaut (bouton discret) pour ne pas charger le formulaire ;
 *   déplié et prérempli si on arrive via /r/CODE (?ref=).
 * - Validation INLINE via la RPC anon `referral_code_valid` (debounce) —
 *   purement informative : un code invalide n'empêche JAMAIS l'inscription
 *   (l'attribution serveur est best-effort).
 */
type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "valid"; name: string; amountDa: number }
  | { kind: "invalid" };

const CODE_RE = /[^A-HJ-NP-Z2-9]/g;

export function ReferralCodeField({
  initialCode,
  disabled,
}: {
  initialCode: string;
  disabled?: boolean;
}) {
  const t = useTranslations("auth");
  const clean = initialCode.toUpperCase().replace(CODE_RE, "").slice(0, 8);
  const [open, setOpen] = useState(clean.length > 0);
  const [code, setCode] = useState(clean);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validate = useCallback(async (value: string) => {
    if (value.length !== 8) {
      setCheck({ kind: "idle" });
      return;
    }
    setCheck({ kind: "checking" });
    try {
      const supabase = createClient();
      // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{
        data: {
          valid: boolean;
          referrer_name?: string;
          reward_referee_da?: number;
        } | null;
      }>;
      const { data } = await rpc("referral_code_valid", { p_code: value });
      if (data?.valid) {
        setCheck({
          kind: "valid",
          name: data.referrer_name ?? "",
          amountDa: data.reward_referee_da ?? 0,
        });
      } else {
        setCheck({ kind: "invalid" });
      }
    } catch {
      // Réseau indisponible : on n'affiche rien de bloquant.
      setCheck({ kind: "idle" });
    }
  }, []);

  // Code arrivé par le lien /r/CODE → vérification immédiate.
  useEffect(() => {
    if (clean.length === 8) void validate(clean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-primary-700 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
      >
        <Gift className="size-4" />
        {t("referralHaveCode")}
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="referral_code">{t("referralCodeLabel")}</Label>
      <div className="relative">
        <Gift className="text-subtle pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          id="referral_code"
          name="referral_code"
          value={code}
          onChange={(e) => {
            const v = e.target.value
              .toUpperCase()
              .replace(CODE_RE, "")
              .slice(0, 8);
            setCode(v);
            setCheck({ kind: "idle" });
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void validate(v), 450);
          }}
          disabled={disabled}
          maxLength={8}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD2345"
          className="ps-9 font-mono tracking-widest uppercase"
        />
        {check.kind === "checking" && (
          <Loader2 className="text-subtle absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin" />
        )}
        {check.kind === "valid" && (
          <Check className="text-success-600 absolute end-3 top-1/2 size-4 -translate-y-1/2" />
        )}
      </div>
      {check.kind === "valid" && (
        <p className="text-success-700 text-xs font-medium">
          {t("referralValid", {
            name: check.name,
            amount: check.amountDa,
          })}
        </p>
      )}
      {check.kind === "invalid" && (
        <p className="text-xs text-rose-600">{t("referralInvalid")}</p>
      )}
    </div>
  );
}
