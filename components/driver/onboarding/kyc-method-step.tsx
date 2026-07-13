"use client";

// =============================================================================
// INSCRIPTION LIVREUR — ÉTAPE « Vérification d'identité ».
// Deux voies, présentées comme chez les néobanques : l'INSTANTANÉE (scan +
// selfie, résultat en quelques secondes) et la MANUELLE (envoi des pièces,
// examinées sous 24-72 h). Quand l'équipe Coligo a rendu la vérification
// automatique obligatoire, il n'y a PAS de choix : la voie instantanée est
// annoncée comme imposée, sans faux boutons.
//
// La voie manuelle réaffiche le dépôt de pièces existant (passé en `children`)
// — aucune duplication de code.
// =============================================================================

import { useState, useTransition } from "react";
import { BadgeCheck, Clock, FileText, Loader2, Zap } from "lucide-react";
import { setDriverKycMethod } from "@/app/(driver)/actions";
import type { KycMethod } from "@/lib/driver/kyc";

export type IdvChoiceState = {
  available: boolean;
  forced: boolean;
  method: KycMethod | null;
  verified: boolean;
  inProgress: boolean;
  route: string;
};

export function KycMethodStep({
  idv,
  method,
  onMethod,
  children,
}: {
  idv: IdvChoiceState;
  /** Méthode retenue (état HISSÉ dans le formulaire : c'est lui qui décide du
   *  bouton d'action — il n'y en a JAMAIS deux à l'écran). */
  method: KycMethod | null;
  onMethod: (m: KycMethod) => void;
  /** Dépôt manuel des pièces (composant existant du formulaire). */
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Vérification automatique non publiée → l'ancien parcours, tel quel.
  if (!idv.available) return <>{children}</>;

  const choose = (m: KycMethod) => {
    setError(null);
    onMethod(m);
    startTransition(async () => {
      const res = await setDriverKycMethod(m);
      if (!res.ok) {
        setError(res.error ?? "Choix impossible.");
        onMethod(idv.method ?? "manual");
      }
    });
  };

  // ── État du parcours automatique (commun aux deux cas) ────────────────────
  const instantPanel = (
    <div
      className="rounded-[16px] border p-4"
      style={{
        borderColor: "var(--line)",
        background: "var(--surface)",
      }}
    >
      {idv.verified ? (
        <div className="flex items-center gap-2.5">
          <BadgeCheck className="size-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-[14px] font-bold">Identité vérifiée</p>
            <p className="text-[12px] text-[var(--muted)]">
              Aucune pièce d&apos;identité à envoyer.
            </p>
          </div>
        </div>
      ) : idv.inProgress ? (
        <div className="flex items-center gap-2.5">
          <Clock className="size-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-[14px] font-bold">Vérification en cours</p>
            <p className="text-[12px] text-[var(--muted)]">
              Vous serez notifié dès qu&apos;elle sera confirmée.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <Zap
            className="size-5 shrink-0"
            style={{ color: "var(--d-violet, #6C2BD9)" }}
          />
          <div>
            <p className="text-[14px] font-bold">Scan + selfie</p>
            <p className="text-[12px] text-[var(--muted)]">
              Résultat en quelques secondes.
            </p>
          </div>
        </div>
      )}
    </div>
  );

  // ── Vérification OBLIGATOIRE : pas de choix, on l'annonce clairement ──────
  if (idv.forced) {
    return (
      <div className="space-y-3">
        <div
          className="flex items-start gap-2.5 rounded-[14px] p-3"
          style={{ background: "var(--violet-soft)" }}
        >
          <Zap
            className="mt-0.5 size-5 shrink-0"
            style={{ color: "var(--d-violet, #6C2BD9)" }}
          />
          <div>
            <p className="text-[14px] font-bold">Vérification instantanée</p>
            <p className="text-[12px] text-[var(--muted)]">
              Exigée pour tous les livreurs · 2 min
            </p>
          </div>
        </div>
        {instantPanel}
      </div>
    );
  }

  // ── Choix libre : deux cartes ─────────────────────────────────────────────
  const Card = ({
    value,
    icon,
    title,
    delay,
    desc,
  }: {
    value: KycMethod;
    icon: React.ReactNode;
    title: string;
    delay: string;
    desc: string;
  }) => {
    const active = method === value;
    return (
      <button
        type="button"
        onClick={() => choose(value)}
        disabled={pending}
        className="w-full rounded-[16px] border p-3.5 text-left transition-colors disabled:opacity-60"
        style={{
          borderColor: active ? "var(--d-violet, #6C2BD9)" : "var(--line)",
          background: active ? "rgba(108,43,217,.06)" : "var(--surface)",
          boxShadow: active
            ? "0 0 0 1px var(--d-violet, #6C2BD9) inset"
            : undefined,
        }}
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold">{title}</p>
            <p className="text-[12px] text-[var(--muted)]">{delay}</p>
          </div>
          {pending && active ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <span
              className="size-4 shrink-0 rounded-full border-2"
              style={{
                borderColor: active
                  ? "var(--d-violet, #6C2BD9)"
                  : "var(--line)",
                background: active ? "var(--d-violet, #6C2BD9)" : "transparent",
              }}
            />
          )}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
          {desc}
        </p>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[var(--muted)]">
        Comment souhaitez-vous prouver votre identité ?
      </p>

      <Card
        value="instant"
        icon={
          <Zap
            className="size-5 shrink-0"
            style={{ color: "var(--d-violet, #6C2BD9)" }}
          />
        }
        title="Vérification instantanée"
        delay="Résultat immédiat · 2 minutes"
        desc="Scannez votre pièce et faites un selfie. Aucune pièce à téléverser."
      />
      <Card
        value="manual"
        icon={<FileText className="size-5 shrink-0 text-[var(--muted)]" />}
        title="Vérification manuelle"
        delay="Examen par l'équipe Coligo · 24 à 72 h"
        desc="Envoyez les photos de votre pièce d'identité et un selfie."
      />

      {error && <p className="text-[12px] text-red-600">{error}</p>}

      {method === "instant" && instantPanel}
      {method === "manual" && <div className="pt-1">{children}</div>}
    </div>
  );
}
