"use client";

// =============================================================================
// IDV — L'ÉTAPE « Vérification d'identité », PARTAGÉE par les trois espaces
// (livreur, chauffeur, commerçant). Un seul endroit décrit :
//   • l'état du parcours (à faire / en cours / vérifiée) — UN bloc, jamais deux
//     libellés qui disent la même chose ;
//   • le choix de la voie quand il existe : INSTANTANÉE (scan + selfie, réponse
//     en quelques secondes) ou MANUELLE (pièces examinées sous 24-72 h) ;
//   • LE bouton d'action — il n'y en a qu'UN à l'écran, et son libellé est celui
//     de la prochaine chose à faire.
//
// RÈGLE MÉTIER, la même partout : on ne peut pas avancer sans identité prouvée.
// Tant que la vérification n'est pas faite, le bouton dit « Vérifier mon
// identité » ; « Continuer » / « Envoyer mon dossier » n'apparaît qu'après.
//
// Chaque espace fournit sa propre action serveur d'enregistrement du choix
// (`saveMethod`) : le composant ne connaît ni la table `drivers`, ni
// `chauffeurs` — il ne connaît que l'état.
// =============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  ScanFace,
  ShieldAlert,
  Zap,
} from "lucide-react";
import {
  idvGate,
  type IdvChoiceState,
  type IdvMethod,
} from "@/lib/idv/ui-state";
import { IdvScope } from "./idv-theme";

// Types seulement : ré-exporter une FONCTION depuis un module « use client » la
// rendrait inappelable côté serveur (elle y devient une référence client). Les
// règles vivent dans lib/idv/ui-state.ts — importez-les de là.
export type { IdvChoiceState, IdvGate, IdvMethod } from "@/lib/idv/ui-state";

/* ───────────────────────────── Bloc d'état ───────────────────────────── */

export function IdvStatusBlock({ idv }: { idv: IdvChoiceState }) {
  const [icon, title, hint] = idv.rejected
    ? [
        <ShieldAlert
          key="i"
          className="size-5 shrink-0"
          style={{ color: "var(--idv-bad)" }}
        />,
        "Vérification refusée",
        "Réessayez, ou faites examiner vos pièces par l'équipe Coligo.",
      ]
    : idv.verified
      ? [
          <BadgeCheck
            key="i"
            className="size-5 shrink-0"
            style={{ color: "var(--idv-ok)" }}
          />,
          "Identité vérifiée",
          "Aucune pièce à envoyer.",
        ]
      : idv.inProgress
        ? [
            <Clock
              key="i"
              className="size-5 shrink-0"
              style={{ color: "var(--idv-warn)" }}
            />,
            "Vérification en cours",
            "Vous serez notifié dès qu'elle sera confirmée.",
          ]
        : [
            <Zap
              key="i"
              className="size-5 shrink-0"
              style={{ color: "var(--idv-accent)" }}
            />,
            "Scan + selfie · 2 min",
            idv.forced
              ? "Vérification exigée par l'équipe Coligo."
              : "Résultat en quelques secondes.",
          ];

  return (
    <div
      className="flex items-center gap-2.5 rounded-[14px] p-3.5"
      style={{ background: "var(--idv-soft)" }}
    >
      {icon}
      <div className="min-w-0">
        <p className="text-[14px] font-bold">{title}</p>
        <p className="text-[12px]" style={{ color: "var(--idv-muted)" }}>
          {hint}
        </p>
      </div>
    </div>
  );
}

/* ────────────────────────────── L'étape ─────────────────────────────── */

export function IdvVerifyStep({
  idv,
  method,
  onMethod,
  saveMethod,
  allowManual = true,
  children,
}: {
  idv: IdvChoiceState;
  /** Voie retenue — état HISSÉ par l'écran : c'est LUI qui porte le bouton. */
  method: IdvMethod | null;
  onMethod: (m: IdvMethod) => void;
  /** Action serveur de l'espace qui persiste le choix. */
  saveMethod: (m: IdvMethod) => Promise<{ ok: boolean; error?: string }>;
  /** L'espace propose-t-il une voie manuelle (dépôt de pièces) ? */
  allowManual?: boolean;
  /** Dépôt manuel des pièces — le composant existant de l'espace. */
  children?: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Vérification non publiée → l'écran d'avant, tel quel.
  if (!idv.available) return <>{children}</>;

  // Imposée, ou pas de voie manuelle possible : rien à choisir.
  if (idv.forced || !allowManual)
    return (
      <IdvScope>
        <IdvStatusBlock idv={idv} />
      </IdvScope>
    );

  const choose = (m: IdvMethod) => {
    setError(null);
    onMethod(m);
    startTransition(async () => {
      const res = await saveMethod(m);
      if (!res.ok) {
        setError(res.error ?? "Choix impossible.");
        onMethod(idv.method ?? "manual");
      }
    });
  };

  const Card = ({
    value,
    icon,
    title,
    delay,
  }: {
    value: IdvMethod;
    icon: React.ReactNode;
    title: string;
    delay: string;
  }) => {
    const active = method === value;
    return (
      <button
        type="button"
        onClick={() => choose(value)}
        disabled={pending}
        className="flex w-full items-center gap-2.5 rounded-[16px] border p-3.5 text-left transition-colors disabled:opacity-60"
        style={{
          borderColor: active ? "var(--idv-accent)" : "var(--idv-line)",
          background: active ? "var(--idv-soft)" : "var(--idv-card)",
          boxShadow: active ? "0 0 0 1px var(--idv-accent) inset" : undefined,
        }}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold">{title}</span>
          <span
            className="block text-[12px]"
            style={{ color: "var(--idv-muted)" }}
          >
            {delay}
          </span>
        </span>
        {pending && active ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <span
            className="size-4 shrink-0 rounded-full border-2"
            style={{
              borderColor: active ? "var(--idv-accent)" : "var(--idv-line)",
              background: active ? "var(--idv-accent)" : "transparent",
            }}
          />
        )}
      </button>
    );
  };

  return (
    <IdvScope className="space-y-2.5">
      <p className="text-[13px]" style={{ color: "var(--idv-muted)" }}>
        {idv.rejected
          ? "La vérification automatique n'a pas abouti. Réessayez, ou confiez vos pièces à l'équipe Coligo."
          : "Comment souhaitez-vous prouver votre identité ?"}
      </p>

      <Card
        value="instant"
        icon={
          <Zap
            className="size-5 shrink-0"
            style={{ color: "var(--idv-accent)" }}
          />
        }
        title={
          idv.rejected
            ? "Réessayer la vérification"
            : "Vérification instantanée"
        }
        delay="Scan + selfie · 2 min"
      />
      <Card
        value="manual"
        icon={
          <FileText
            className="size-5 shrink-0"
            style={{ color: "var(--idv-muted)" }}
          />
        }
        title="Vérification manuelle"
        delay="Examen par l'équipe Coligo · 24 à 72 h"
      />

      {error && (
        <p
          className="text-[12px] font-bold"
          style={{ color: "var(--idv-bad)" }}
        >
          {error}
        </p>
      )}

      {/* La carte sélectionnée dit déjà « Scan + selfie · 2 min » : le bloc
          d'état ne s'affiche QUE s'il apporte une information nouvelle (examen
          en cours, identité vérifiée, tentative refusée). Sinon il ne ferait que
          répéter la carte — doublon interdit. */}
      {method === "instant" &&
        (idv.verified || idv.inProgress || idv.rejected) && (
          <IdvStatusBlock idv={idv} />
        )}
      {method === "manual" && <div className="pt-1">{children}</div>}
    </IdvScope>
  );
}

/* ──────────────────────────── LE bouton unique ───────────────────────── */

/**
 * Rendu du bouton d'action de l'écran. Tant que la vérification bloque, il
 * porte l'action de vérification ; sinon il rend le bouton de l'écran
 * (`children`) — « Continuer », « Envoyer mon dossier »… Jamais les deux.
 */
export function IdvPrimaryButton({
  idv,
  method,
  busy,
  children,
}: {
  idv: IdvChoiceState;
  method: IdvMethod | null;
  busy?: boolean;
  /** Le bouton de l'écran, affiché UNIQUEMENT quand rien ne bloque. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const gate = idvGate(idv, method);

  if (gate.action === null) return <>{children}</>;

  if (gate.action === "refresh")
    return (
      <IdvScope>
        <button
          type="button"
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending || busy}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] border text-[15px] font-bold disabled:opacity-40"
          style={{
            borderColor: "var(--idv-line)",
            background: "var(--idv-card)",
            color: "var(--idv-ink)",
          }}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Actualiser
        </button>
      </IdvScope>
    );

  return (
    <IdvScope>
      <button
        type="button"
        onClick={() => startTransition(() => router.push(idv.route))}
        disabled={pending || busy}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-extrabold text-white disabled:opacity-40"
        style={{ background: "var(--idv-accent)" }}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ScanFace className="size-4" />
        )}
        {idv.rejected ? "Réessayer la vérification" : "Vérifier mon identité"}
      </button>
    </IdvScope>
  );
}
