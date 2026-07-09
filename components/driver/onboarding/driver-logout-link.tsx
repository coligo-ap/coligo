"use client";

import { useState, useTransition } from "react";
import { LogOut } from "lucide-react";
import { driverLogout } from "@/app/(driver)/actions";
import { PartnerInlineError } from "@/components/shared/partner-ui";

/** Seule sortie offerte pendant le parcours d'inscription : se déconnecter. */
export function DriverLogoutLink() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <PartnerInlineError>{error}</PartnerInlineError>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await driverLogout();
            if (r?.error) setError(r.error);
          })
        }
        className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--muted)] disabled:opacity-50"
      >
        <LogOut className="size-3.5" />
        Se déconnecter
      </button>
    </>
  );
}
