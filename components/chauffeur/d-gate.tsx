"use client";

import {
  Ban,
  Clock,
  CreditCard,
  Lock,
  Star,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  VIOLET,
  GO,
  RED,
  PrimaryBtn,
  GhostBtn,
} from "@/components/customer/drive/drive-modals";
import { chauffeurLogout } from "@/app/(chauffeur)/actions";

/** Dossier envoyé — en attente de validation par les SUPER ADMINS (s-dwait). */
export function DWait() {
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-10 pb-8">
      <div className="text-center">
        <span
          className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "#EEEEFD" }}
        >
          <Clock className="size-7" style={{ color: VIOLET }} />
        </span>
        <h1 className="drive-sora text-[21px] font-extrabold">
          Dossier envoyé ✓
        </h1>
        <p className="mx-auto mt-1 max-w-[290px] text-[13px] text-[var(--d-muted)]">
          Les <b>super admins Coligo</b> vérifient vos documents. Vous ne
          pourrez accéder à votre compte chauffeur qu&apos;après validation
          (24–48 h). Vous serez notifié.
        </p>
      </div>

      <div className="mx-auto mt-5 max-w-[320px]">
        <Step state="ok" title="Dossier envoyé" sub="À l'instant" />
        <Step
          state="cur"
          title="Vérification par les super admins"
          sub="Documents · selfie · véhicule"
        />
        <Step
          state="todo"
          n={3}
          title="Compte activé"
          sub="Vous pourrez vous connecter et recevoir des courses"
          last
        />
      </div>

      <GhostBtn onClick={() => void chauffeurLogout()}>Se déconnecter</GhostBtn>
    </div>
  );
}

function Step({
  state,
  n,
  title,
  sub,
  last,
}: {
  state: "ok" | "cur" | "todo";
  n?: number;
  title: string;
  sub: string;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className="grid size-[26px] shrink-0 place-items-center rounded-full text-xs font-bold"
          style={
            state === "ok"
              ? { background: GO, color: "#fff" }
              : state === "cur"
                ? {
                    background: "#EEEEFD",
                    color: VIOLET,
                    border: `2px solid ${VIOLET}`,
                  }
                : { background: "var(--d-soft)", color: "var(--d-muted)" }
          }
        >
          {state === "ok" ? "✓" : state === "cur" ? "⏳" : n}
        </span>
        {!last && (
          <span className="min-h-[18px] w-[2px] flex-1 bg-[var(--d-line)]" />
        )}
      </div>
      <div className="pb-4 text-[13px] font-semibold">
        {title}
        <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
          {sub}
        </small>
      </div>
    </div>
  );
}

/** Compte gelé (s-dfrozen) — motifs possibles + contact support. */
export function DFrozen({ reason }: { reason: string | null }) {
  const motifs = [
    {
      icon: <CreditCard className="size-4.5" style={{ color: RED }} />,
      title: "Impayé envers la plateforme",
      sub: "Commissions ou abonnement non reversés à l'échéance",
    },
    {
      icon: <X className="size-4.5" style={{ color: RED }} />,
      title: "Annulations répétées",
      sub: "Taux d'annulation au-dessus du seuil autorisé",
    },
    {
      icon: <AlertTriangle className="size-4.5" style={{ color: RED }} />,
      title: "Comportement signalé",
      sub: "Non-respect des clients ou des conditions de la plateforme",
    },
    {
      icon: <Star className="size-4.5" style={{ color: RED }} />,
      title: "Note trop basse",
      sub: "Note moyenne durablement sous le seuil minimal",
    },
  ];
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-10 pb-8">
      <div className="text-center">
        <span
          className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(229,72,77,.12)" }}
        >
          <Lock className="size-7" style={{ color: RED }} />
        </span>
        <h1
          className="drive-sora text-[21px] font-extrabold"
          style={{ color: RED }}
        >
          Compte gelé
        </h1>
        <p className="mx-auto mt-1 mb-3 max-w-[300px] text-[13px] text-[var(--d-muted)]">
          Votre compte chauffeur a été suspendu par Coligo.{" "}
          {reason ? (
            <>
              Motif : <b className="text-[var(--d-ink)]">{reason}</b>
            </>
          ) : (
            "Motifs possibles :"
          )}
        </p>
      </div>
      {motifs.map((m) => (
        <div
          key={m.title}
          className="mb-2 flex items-center gap-3 rounded-[15px] border border-[var(--d-line)] p-3"
        >
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-[var(--d-soft)]">
            {m.icon}
          </span>
          <span>
            <b className="block text-[13.5px]">{m.title}</b>
            <small className="text-[11px] text-[var(--d-muted)]">{m.sub}</small>
          </span>
        </div>
      ))}
      <PrimaryBtn
        onClick={() => window.open("mailto:support@coligo.app", "_self")}
      >
        Contacter le support Coligo
      </PrimaryBtn>
      <GhostBtn onClick={() => void chauffeurLogout()}>Se déconnecter</GhostBtn>
    </div>
  );
}

/** Compte bloqué (suspension dure). */
export function DBlocked() {
  return (
    <div className="drive-jakarta drive-page grid min-h-screen place-items-center bg-[var(--d-surface)] px-5">
      <div className="text-center">
        <span
          className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(229,72,77,.12)" }}
        >
          <Ban className="size-7" style={{ color: RED }} />
        </span>
        <h1
          className="drive-sora text-[21px] font-extrabold"
          style={{ color: RED }}
        >
          Compte suspendu
        </h1>
        <p className="mx-auto mt-1 max-w-[290px] text-[13px] text-[var(--d-muted)]">
          Votre compte a été suspendu définitivement. Contactez le support
          Coligo pour plus d&apos;informations.
        </p>
        <GhostBtn onClick={() => void chauffeurLogout()}>
          Se déconnecter
        </GhostBtn>
      </div>
    </div>
  );
}
