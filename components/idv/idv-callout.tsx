import Link from "next/link";
import { BadgeCheck, ChevronRight, Clock, ShieldAlert } from "lucide-react";
import { getIdvCompliance } from "@/lib/idv/compliance";
import type { IdvProfile } from "@/lib/idv/types";
import { IdvScope } from "./idv-theme";

// =============================================================================
// IDV — BANNIÈRE d'appel à vérification, posée dans les écrans « compte » des
// trois espaces ET dans le parcours d'inscription livreur. Server Component :
// elle disparaît d'elle-même quand la fonctionnalité n'est pas publiée, quand
// le profil n'est pas concerné, ou quand l'identité est déjà vérifiée.
// Textes courts (style Bolt) : un état, une action.
// =============================================================================

export async function IdvCallout({ profile }: { profile: IdvProfile }) {
  const c = await getIdvCompliance(profile);
  if (!c.enabled) return null;

  // Vérifiée : une simple confirmation discrète (pas de bouton).
  if (c.verified) {
    return (
      <IdvScope
        className="flex items-center gap-2.5 rounded-[14px] p-3"
        style={{
          background: "var(--idv-card)",
          border: "1px solid var(--idv-line)",
        }}
      >
        <BadgeCheck
          className="size-5 shrink-0"
          style={{ color: "var(--idv-ok)" }}
        />
        <p className="text-sm font-medium">Identité vérifiée</p>
      </IdvScope>
    );
  }

  // En cours d'examen : on informe, on ne demande rien.
  if (c.inProgress) {
    return (
      <IdvScope
        className="flex items-center gap-2.5 rounded-[14px] p-3"
        style={{
          background: "var(--idv-card)",
          border: "1px solid var(--idv-line)",
        }}
      >
        <Clock
          className="size-5 shrink-0"
          style={{ color: "var(--idv-warn)" }}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">Vérification en cours</p>
          <p className="text-xs" style={{ color: "var(--idv-muted)" }}>
            Vous serez notifié du résultat.
          </p>
        </div>
      </IdvScope>
    );
  }

  // À faire : obligatoire (rouge) ou facultatif (violet de marque).
  const urgent = c.required;
  return (
    <IdvScope>
      <Link
        href={c.route}
        className="flex items-center gap-2.5 rounded-[14px] p-3 transition-transform active:scale-[.99]"
        style={{
          background: urgent ? "rgba(239,68,68,.10)" : "var(--idv-soft)",
          border: `1px solid ${urgent ? "rgba(239,68,68,.35)" : "var(--idv-line)"}`,
        }}
      >
        <ShieldAlert
          className="size-5 shrink-0"
          style={{ color: urgent ? "var(--idv-bad)" : "var(--idv-accent)" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {c.status === "rejected"
              ? "Vérification refusée"
              : urgent
                ? "Vérifiez votre identité"
                : "Vérifiez votre identité (facultatif)"}
          </p>
          <p className="text-xs" style={{ color: "var(--idv-muted)" }}>
            {c.status === "rejected"
              ? "Contactez le support"
              : urgent
                ? "Obligatoire pour continuer · 2 minutes"
                : "Document + selfie · 2 minutes"}
          </p>
        </div>
        <ChevronRight
          className="size-4 shrink-0"
          style={{ color: "var(--idv-muted)" }}
        />
      </Link>
    </IdvScope>
  );
}
