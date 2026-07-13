import Link from "next/link";
import { BadgeCheck, ChevronRight, Clock, ShieldAlert } from "lucide-react";
import { getIdvCompliance } from "@/lib/idv/compliance";
import type { IdvProfile } from "@/lib/idv/types";

// =============================================================================
// IDV — BANNIÈRE d'appel à vérification, posée dans les écrans « compte » des
// trois espaces. Server Component : elle disparaît d'elle-même quand la
// fonctionnalité n'est pas publiée, quand le profil n'est pas concerné, ou
// quand l'identité est déjà vérifiée (aucun bruit inutile).
// Textes courts (style Bolt) : un état, une action.
// =============================================================================

export async function IdvCallout({ profile }: { profile: IdvProfile }) {
  const c = await getIdvCompliance(profile);
  if (!c.enabled) return null;

  // Vérifiée : une simple confirmation discrète (pas de bouton).
  if (c.verified) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-[14px] p-3"
        style={{
          background: "var(--d-card, #fff)",
          border: "1px solid var(--d-line, rgba(0,0,0,.08))",
        }}
      >
        <BadgeCheck
          className="size-5 shrink-0"
          style={{ color: "var(--d-mint, #10b981)" }}
        />
        <p className="text-sm font-medium">Identité vérifiée</p>
      </div>
    );
  }

  // En cours d'examen : on informe, on ne demande rien.
  if (c.inProgress) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-[14px] p-3"
        style={{
          background: "var(--d-card, #fff)",
          border: "1px solid var(--d-line, rgba(0,0,0,.08))",
        }}
      >
        <Clock
          className="size-5 shrink-0"
          style={{ color: "var(--d-amber, #f59e0b)" }}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">Vérification en cours</p>
          <p className="text-xs" style={{ color: "var(--d-muted)" }}>
            Vous serez notifié du résultat.
          </p>
        </div>
      </div>
    );
  }

  // À faire : obligatoire (rouge) ou facultatif (accent).
  const urgent = c.required;
  return (
    <Link
      href={c.route}
      className="flex items-center gap-2.5 rounded-[14px] p-3 transition-transform active:scale-[.99]"
      style={{
        background: urgent
          ? "rgba(239,68,68,.10)"
          : "var(--d-soft, rgba(108,43,217,.10))",
        border: `1px solid ${urgent ? "rgba(239,68,68,.35)" : "var(--d-line, rgba(0,0,0,.08))"}`,
      }}
    >
      <ShieldAlert
        className="size-5 shrink-0"
        style={{
          color: urgent ? "var(--d-coral, #ef4444)" : "var(--d-accent)",
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {c.status === "rejected"
            ? "Vérification refusée"
            : urgent
              ? "Vérifiez votre identité"
              : "Vérifiez votre identité (facultatif)"}
        </p>
        <p className="text-xs" style={{ color: "var(--d-muted)" }}>
          {c.status === "rejected"
            ? "Contactez le support"
            : urgent
              ? "Obligatoire pour continuer · 2 minutes"
              : "Document + selfie · 2 minutes"}
        </p>
      </div>
      <ChevronRight
        className="size-4 shrink-0"
        style={{ color: "var(--d-muted)" }}
      />
    </Link>
  );
}
