"use client";

import { useFormStatus } from "react-dom";
import { Loader2, LogOut } from "lucide-react";
import { customerLogout } from "@/app/(customer)/actions";

/** Bouton déconnexion client avec loader « Déconnexion en cours… ». */
export function CustomerLogoutButton() {
  return (
    <form action={customerLogout} className="mt-6">
      <Inner />
    </form>
  );
}

function Inner() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 hover:border-danger-300 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border text-sm font-semibold transition-colors disabled:opacity-70"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <LogOut className="size-4" />
      )}
      {pending ? "Déconnexion en cours…" : "Déconnexion"}
    </button>
  );
}
